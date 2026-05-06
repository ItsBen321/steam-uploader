import fs from "node:fs";
import path from "node:path";
import { parseGodotExportPresets, findMissingExportPresets } from "../shared/godot";
import { parseSteamLog } from "../shared/logParser";
import type {
  AppSnapshot,
  GameProfile,
  LogSource,
  PipelineEvent,
  ReleaseRun,
  Settings
} from "../shared/types";
import { validateProfile, validateTools } from "../shared/validation";
import { generateAppBuildScripts, renderBuildDescription } from "../shared/vdf";
import { type AppDatabase } from "./database";
import { type CommandRunner, runCommand } from "./processRunner";

class CancelledError extends Error {
  constructor() {
    super("Release run cancelled.");
  }
}

interface ActiveRun {
  abortController: AbortController;
  steamLines: string[];
}

export class ReleasePipeline {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly queuedRunIds: string[] = [];
  private activeRunId: string | null = null;

  constructor(
    private readonly db: AppDatabase,
    private readonly appDataPath: string,
    private readonly emit: (event: PipelineEvent) => void,
    private readonly runner: CommandRunner = runCommand
  ) {}

  startRelease(profileId: string): ReleaseRun {
    const profile = this.requireProfile(profileId);
    const run = this.db.createRun(profile.id);
    this.emit({ type: "run-updated", run });
    this.queuedRunIds.push(run.id);
    this.log(
      run.id,
      "system",
      this.activeRunId ? "Release run queued. It will start after the active run finishes." : "Release run queued."
    );
    this.processQueue();

    return run;
  }

  confirmUpload(runId: string): ReleaseRun {
    const run = this.db.getRun(runId);
    if (!run) {
      throw new Error(`Unknown run ${runId}`);
    }

    if (run.status !== "awaiting_confirmation") {
      throw new Error("This run is not waiting for upload confirmation.");
    }

    if (this.activeRunId && this.activeRunId !== runId) {
      throw new Error("Another release run is active. Try again after the queue finishes.");
    }

    const context = this.activeRuns.get(runId) ?? { abortController: new AbortController(), steamLines: [] };
    this.activeRunId = runId;
    this.activeRuns.set(runId, context);

    void this.executeConfirmedUpload(runId, context);

    return this.updateRun(runId, { status: "running", stage: "uploading", error: null });
  }

  cancelRun(runId: string): ReleaseRun {
    const queuedIndex = this.queuedRunIds.indexOf(runId);
    if (queuedIndex >= 0) {
      this.queuedRunIds.splice(queuedIndex, 1);
      this.log(runId, "system", "Queued run cancelled.");
      const cancelled = this.updateRun(runId, {
        status: "cancelled",
        stage: "cancelled",
        finishedAt: new Date().toISOString(),
        error: "Cancelled by user."
      });
      this.emitSnapshot();
      return cancelled;
    }

    const run = this.db.getRun(runId);
    if (!run) {
      throw new Error(`Unknown run ${runId}`);
    }

    if (run.status === "queued") {
      this.log(runId, "system", "Queued run cancelled.");
      const cancelled = this.updateRun(runId, {
        status: "cancelled",
        stage: "cancelled",
        finishedAt: new Date().toISOString(),
        error: "Cancelled by user."
      });
      this.emitSnapshot();
      return cancelled;
    }

    const context = this.activeRuns.get(runId);
    if (!context) {
      return run;
    }

    context?.abortController.abort();
    this.log(runId, "system", "Cancellation requested.");
    return this.updateRun(runId, {
      status: "cancelled",
      stage: "cancelled",
      finishedAt: new Date().toISOString(),
      error: "Cancelled by user."
    });
  }

  readExportPresets(projectPath: string) {
    const presetsPath = path.join(projectPath, "export_presets.cfg");
    if (!fs.existsSync(presetsPath)) {
      return [];
    }

    return parseGodotExportPresets(fs.readFileSync(presetsPath, "utf8"));
  }

  private processQueue(): void {
    if (this.activeRunId) {
      return;
    }

    while (this.queuedRunIds.length > 0) {
      const runId = this.queuedRunIds.shift()!;
      const run = this.db.getRun(runId);
      if (!run || run.status !== "queued") {
        continue;
      }

      const context: ActiveRun = { abortController: new AbortController(), steamLines: [] };
      this.activeRunId = runId;
      this.activeRuns.set(runId, context);
      void this.executeQueuedRun(runId, context);
      return;
    }
  }

  private async executeQueuedRun(runId: string, context: ActiveRun): Promise<void> {
    try {
      this.log(runId, "system", "Starting release run.");
      await this.executePreview(runId, context);
      await this.executeUpload(runId, context);
    } catch (error: unknown) {
      this.failRun(runId, context, error);
    } finally {
      this.activeRuns.delete(runId);
      if (this.activeRunId === runId) {
        this.activeRunId = null;
      }

      const run = this.db.getRun(runId);
      if (run?.status === "completed") {
        this.processQueue();
      } else {
        this.cancelPendingQueuedRuns("Queue stopped because the previous run did not complete.");
      }
    }
  }

  private async executeConfirmedUpload(runId: string, context: ActiveRun): Promise<void> {
    try {
      await this.executeUpload(runId, context);
    } catch (error: unknown) {
      this.failRun(runId, context, error);
    } finally {
      this.activeRuns.delete(runId);
      if (this.activeRunId === runId) {
        this.activeRunId = null;
      }
      const run = this.db.getRun(runId);
      if (run?.status === "completed") {
        this.processQueue();
      } else {
        this.cancelPendingQueuedRuns("Queue stopped because the previous run did not complete.");
      }
    }
  }

  private async executePreview(runId: string, context: ActiveRun): Promise<void> {
    const settings = this.db.getSettings();
    const profile = this.requireRunProfile(runId);
    this.assertNotCancelled(context);
    this.updateRun(runId, { status: "running", stage: "validating", error: null });
    this.log(runId, "system", `Validating ${profile.name}.`);
    this.validateRunInputs(settings, profile);

    const runRoot = path.join(this.appDataPath, "release-runs", runId);
    const contentRoot = path.join(runRoot, "content");
    const buildOutput = path.join(runRoot, "steam-output");
    const scriptsRoot = path.join(runRoot, "scripts");
    fs.mkdirSync(contentRoot, { recursive: true });
    fs.mkdirSync(buildOutput, { recursive: true });
    fs.mkdirSync(scriptsRoot, { recursive: true });

    if (profile.buildMode === "godot_export") {
      this.updateRun(runId, { stage: "exporting" });
      for (const depot of profile.depots) {
        this.assertNotCancelled(context);
        const outputPath = this.resolveDepotOutputPath(settings, profile, depot.outputPath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        this.log(runId, "system", `Exporting ${depot.platformLabel || depot.depotId} with Godot preset "${depot.exportPreset}".`);
        await this.runTool(
          runId,
          context,
          settings.godotPath,
          ["--headless", "--path", profile.godotProjectPath, "--export-release", depot.exportPreset, outputPath],
          profile.godotProjectPath,
          "godot"
        );
      }
    } else {
      this.log(runId, "system", "Skipping Godot export. Existing build files will be staged from depot source paths.");
    }

    this.updateRun(runId, { stage: "staging" });
    for (const depot of profile.depots) {
      this.assertNotCancelled(context);
      const outputPath = this.resolveDepotOutputPath(settings, profile, depot.outputPath);
      const sourceDir = this.resolveExportSourceDir(outputPath, profile.buildMode);
      const targetDir = path.join(contentRoot, `depot_${depot.depotId}`);
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(targetDir, { recursive: true });
      this.copyDirectoryContents(sourceDir, targetDir);
      if (!this.hasFiles(targetDir)) {
        throw new Error(`Depot ${depot.depotId} staged no files from ${sourceDir}.`);
      }
      this.log(runId, "system", `Staged depot ${depot.depotId} from ${sourceDir}.`);
    }

    const description = renderBuildDescription(profile.buildDescriptionTemplate, profile);
    const previewScripts = generateAppBuildScripts({
      profile,
      depots: profile.depots,
      contentRoot,
      buildOutput,
      description,
      preview: true
    });
    const uploadScripts = generateAppBuildScripts({
      profile,
      depots: profile.depots,
      contentRoot,
      buildOutput,
      description,
      preview: false,
      setLiveBranch: profile.testBranch.trim() || undefined
    });

    for (const script of previewScripts.depotScripts) {
      fs.writeFileSync(path.join(scriptsRoot, script.fileName), script.content, "utf8");
    }

    const previewScriptPath = path.join(scriptsRoot, previewScripts.appScriptFileName);
    const uploadScriptPath = path.join(scriptsRoot, uploadScripts.appScriptFileName);
    fs.writeFileSync(previewScriptPath, previewScripts.appScriptContent, "utf8");
    fs.writeFileSync(uploadScriptPath, uploadScripts.appScriptContent, "utf8");
    this.log(runId, "system", `Generated SteamPipe scripts in ${scriptsRoot}.`);
    this.updateRun(runId, { previewScriptPath, uploadScriptPath });

    this.updateRun(runId, { stage: "previewing" });
    context.steamLines = [];
    await this.runSteamCmd(runId, context, settings, previewScriptPath);
    const parsedPreview = parseSteamLog(context.steamLines);
    this.updateRun(runId, {
      status: "running",
      stage: "uploading",
      buildId: parsedPreview.buildId,
      manifestIds: parsedPreview.manifestIds,
      error: null
    });
    this.log(runId, "system", "SteamPipe preview finished. Starting upload automatically.");
  }

  private async executeUpload(runId: string, context: ActiveRun): Promise<void> {
    const settings = this.db.getSettings();
    const run = this.db.getRun(runId);
    if (!run?.uploadScriptPath) {
      throw new Error("Upload script is missing. Run preview again.");
    }

    this.assertNotCancelled(context);
    this.updateRun(runId, { status: "running", stage: "uploading", error: null });
    this.log(runId, "system", "Starting SteamPipe upload.");
    context.steamLines = [];
    await this.runSteamCmd(runId, context, settings, run.uploadScriptPath);
    const parsedUpload = parseSteamLog(context.steamLines);
    this.updateRun(runId, {
      status: "completed",
      stage: "completed",
      finishedAt: new Date().toISOString(),
      buildId: parsedUpload.buildId,
      manifestIds: parsedUpload.manifestIds,
      error: null
    });
    this.log(runId, "system", "SteamPipe upload finished.");
  }

  private async runSteamCmd(runId: string, context: ActiveRun, settings: Settings, appScriptPath: string): Promise<void> {
    await this.runTool(
      runId,
      context,
      settings.steamCmdPath,
      ["+login", settings.steamAccount, "+run_app_build", appScriptPath, "+quit"],
      path.dirname(settings.steamCmdPath),
      "steamcmd"
    );
  }

  private async runTool(
    runId: string,
    context: ActiveRun,
    command: string,
    args: string[],
    cwd: string,
    label: "godot" | "steamcmd"
  ): Promise<void> {
    this.log(runId, "system", `${label}: ${command} ${args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ")}`);
    const result = await this.runner(
      command,
      args,
      { cwd, signal: context.abortController.signal },
      (source, line) => {
        const mappedSource: LogSource = source === "stderr" ? "stderr" : label;
        if (label === "steamcmd" && mappedSource !== "stderr") {
          context.steamLines.push(line);
        }
        this.log(runId, mappedSource, line);
      }
    );

    this.assertNotCancelled(context);

    if (result.exitCode !== 0) {
      const parsed = label === "steamcmd" ? parseSteamLog(context.steamLines.concat(result.lines)) : null;
      throw new Error(parsed?.diagnosis ?? `${label} exited with code ${result.exitCode ?? "unknown"}.`);
    }
  }

  private validateRunInputs(settings: Settings, profile: GameProfile): void {
    const toolValidation = validateTools(settings, { requireGodot: profile.buildMode === "godot_export" });
    const profileValidation = validateProfile(profile);
    const errors = [...toolValidation.errors, ...profileValidation.errors];

    if (!settings.defaultExportRoot.trim() && !profile.godotProjectPath.trim()) {
      for (const depot of profile.depots) {
        if (depot.outputPath.trim() && !path.isAbsolute(depot.outputPath)) {
          errors.push(`Depot ${depot.depotId || depot.platformLabel || depot.id} uses a relative path, but no default export root or Godot project path is set.`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join(" "));
    }

    if (profile.buildMode !== "godot_export") {
      return;
    }

    const presets = this.readExportPresets(profile.godotProjectPath);
    const missingPresets = findMissingExportPresets(
      profile.depots.map((depot) => depot.exportPreset),
      presets
    );

    if (missingPresets.length > 0) {
      throw new Error(`Missing Godot export presets: ${missingPresets.join(", ")}.`);
    }
  }

  private resolveDepotOutputPath(settings: Settings, profile: GameProfile, outputPath: string): string {
    if (path.isAbsolute(outputPath)) {
      return outputPath;
    }

    const base = settings.defaultExportRoot.trim() || profile.godotProjectPath;

    return path.resolve(base, outputPath);
  }

  private resolveExportSourceDir(outputPath: string, buildMode: GameProfile["buildMode"]): string {
    if (!fs.existsSync(outputPath)) {
      throw new Error(`${buildMode === "godot_export" ? "Godot export output" : "Existing build source"} was not found: ${outputPath}.`);
    }

    const stats = fs.statSync(outputPath);
    return stats.isDirectory() ? outputPath : path.dirname(outputPath);
  }

  private copyDirectoryContents(sourceDir: string, targetDir: string): void {
    for (const entry of fs.readdirSync(sourceDir)) {
      fs.cpSync(path.join(sourceDir, entry), path.join(targetDir, entry), {
        recursive: true,
        force: true
      });
    }
  }

  private hasFiles(directory: string): boolean {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isFile()) {
        return true;
      }
      if (entry.isDirectory() && this.hasFiles(entryPath)) {
        return true;
      }
    }
    return false;
  }

  private assertNotCancelled(context: ActiveRun): void {
    if (context.abortController.signal.aborted) {
      throw new CancelledError();
    }
  }

  private requireProfile(profileId: string): GameProfile {
    const profile = this.db.getProfile(profileId);
    if (!profile) {
      throw new Error(`Unknown profile ${profileId}`);
    }
    return profile;
  }

  private requireRunProfile(runId: string): GameProfile {
    const run = this.db.getRun(runId);
    if (!run) {
      throw new Error(`Unknown run ${runId}`);
    }
    return this.requireProfile(run.profileId);
  }

  private updateRun(runId: string, patch: Parameters<AppDatabase["updateRun"]>[1]): ReleaseRun {
    const run = this.db.updateRun(runId, patch);
    this.emit({ type: "run-updated", run });
    return run;
  }

  private log(runId: string, source: LogSource, line: string): void {
    const log = this.db.addLog(runId, source, line);
    this.emit({ type: "log", log });
  }

  private failRun(runId: string, context: ActiveRun, error: unknown): void {
    const isCancelled = error instanceof CancelledError || context.abortController.signal.aborted;
    const message = error instanceof Error ? error.message : String(error);
    const run = this.db.getRun(runId);

    if (!run || run.status === "completed" || run.status === "cancelled") {
      this.activeRuns.delete(runId);
      return;
    }

    const updated = this.updateRun(runId, {
      status: isCancelled ? "cancelled" : "failed",
      stage: isCancelled ? "cancelled" : "failed",
      finishedAt: new Date().toISOString(),
      error: isCancelled ? "Cancelled by user." : message
    });

    this.log(runId, "system", updated.error ?? "Run failed.");
    this.activeRuns.delete(runId);
    this.emitSnapshot();
  }

  private cancelPendingQueuedRuns(reason: string): void {
    const pendingRunIds = this.queuedRunIds.splice(0);
    if (pendingRunIds.length === 0) {
      return;
    }

    for (const runId of pendingRunIds) {
      const run = this.db.getRun(runId);
      if (!run || run.status !== "queued") {
        continue;
      }

      this.updateRun(runId, {
        status: "cancelled",
        stage: "cancelled",
        finishedAt: new Date().toISOString(),
        error: reason
      });
      this.log(runId, "system", reason);
    }

    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    const snapshot: AppSnapshot = this.db.getSnapshot();
    this.emit({ type: "snapshot", snapshot });
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../src/main/database";
import { ReleasePipeline } from "../src/main/pipeline";
import type { CommandRunner } from "../src/main/processRunner";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steam-uploader-test-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("release pipeline", () => {
  it("exports, previews, then uploads to beta automatically", async () => {
    const root = makeTempRoot();
    const contentBuilder = path.join(root, "ContentBuilder");
    const steamCmdPath = path.join(contentBuilder, "builder", "steamcmd.exe");
    const godotPath = path.join(root, "Godot.exe");
    const projectPath = path.join(root, "Game");
    const exportRoot = path.join(root, "exports");
    const appData = path.join(root, "app-data");
    fs.mkdirSync(path.dirname(steamCmdPath), { recursive: true });
    fs.mkdirSync(projectPath, { recursive: true });
    fs.writeFileSync(steamCmdPath, "");
    fs.writeFileSync(godotPath, "");
    fs.writeFileSync(path.join(projectPath, "project.godot"), "");
    fs.writeFileSync(
      path.join(projectPath, "export_presets.cfg"),
      '[preset.0]\nname="Windows Desktop"\nplatform="Windows Desktop"\n'
    );

    const db = await AppDatabase.open(path.join(root, "test.sqlite"));
    db.saveSettings({
      contentBuilderPath: contentBuilder,
      godotPath,
      defaultExportRoot: exportRoot,
      steamAccount: "builder_account"
    });
    const profile = db.saveProfile({
      name: "Clockwork Arena",
      buildMode: "godot_export",
      steamAppId: "123456",
      godotProjectPath: projectPath,
      testBranch: "beta",
      buildDescriptionTemplate: "{game} {branch}",
      depots: [
        {
          depotId: "123457",
          buildNote: "Public Windows build",
          exportPreset: "Windows Desktop",
          outputPath: "windows/game.exe",
          platformLabel: "Windows",
          steamDepotPath: ".",
          recursive: true,
          sortOrder: 0
        }
      ]
    });

    const steamScripts: string[] = [];
    const godotOutputPaths: string[] = [];
    const runner: CommandRunner = async (command, args, _options, onLine) => {
      if (command === godotPath) {
        const outputPath = args.at(-1);
        if (!outputPath) {
          throw new Error("Missing Godot output path.");
        }
        godotOutputPaths.push(outputPath);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, "binary");
        fs.writeFileSync(path.join(path.dirname(outputPath), "game.pck"), "pack");
        onLine("system", "Godot export complete.");
        return { exitCode: 0, signal: null, lines: ["Godot export complete."] };
      }

      if (command === steamCmdPath) {
        const scriptPath = args[3];
        steamScripts.push(fs.readFileSync(scriptPath, "utf8"));
        onLine("system", steamScripts.length === 1 ? "Steam preview complete." : "BuildID 456789 complete.");
        onLine("system", "Depot manifest id 98765432101234567.");
        return { exitCode: 0, signal: null, lines: [] };
      }

      throw new Error(`Unexpected command ${command}`);
    };

    const pipeline = new ReleasePipeline(db, appData, () => undefined, runner);
    const run = pipeline.startRelease(profile.id);
    expect(run.status).toBe("queued");
    const completedRun = await waitFor(() => db.getRun(run.id), (value) => value?.status === "completed");

    expect(completedRun?.previewScriptPath).toBeTruthy();
    expect(completedRun?.uploadScriptPath).toBeTruthy();
    expect(godotOutputPaths).toEqual([path.join(exportRoot, "windows", "game.exe")]);
    expect(steamScripts).toHaveLength(2);
    expect(steamScripts[0]).toContain('"Preview" "1"');
    expect(steamScripts[0]).not.toContain("SetLive");
    expect(steamScripts[1]).toContain('"SetLive" "beta"');

    const uploadScript = fs.readFileSync(completedRun!.uploadScriptPath!, "utf8");
    expect(uploadScript).toContain('"SetLive" "beta"');
    expect(fs.existsSync(path.join(appData, "release-runs", run.id, "content", "depot_123457", "game.exe"))).toBe(true);
    expect(fs.existsSync(path.join(appData, "release-runs", run.id, "content", "depot_123457", "game.pck"))).toBe(true);

    expect(completedRun?.buildId).toBe("456789");
    expect(completedRun?.manifestIds).toEqual(["98765432101234567"]);

    db.close();
  });

  it("can upload without setting a beta branch live", async () => {
    const root = makeTempRoot();
    const contentBuilder = path.join(root, "ContentBuilder");
    const steamCmdPath = path.join(contentBuilder, "builder", "steamcmd.exe");
    const existingBuild = path.join(root, "existing-build", "windows");
    const appData = path.join(root, "app-data");
    fs.mkdirSync(path.dirname(steamCmdPath), { recursive: true });
    fs.mkdirSync(existingBuild, { recursive: true });
    fs.writeFileSync(steamCmdPath, "");
    fs.writeFileSync(path.join(existingBuild, "game.exe"), "binary");

    const db = await AppDatabase.open(path.join(root, "test.sqlite"));
    db.saveSettings({
      contentBuilderPath: contentBuilder,
      godotPath: "",
      defaultExportRoot: "",
      steamAccount: "builder_account"
    });
    const profile = db.saveProfile({
      name: "Clockwork Arena",
      buildMode: "existing_folder",
      steamAppId: "123456",
      godotProjectPath: "",
      testBranch: "",
      buildDescriptionTemplate: "{game}",
      depots: [
        {
          depotId: "123457",
          buildNote: "Existing Windows build",
          exportPreset: "",
          outputPath: existingBuild,
          platformLabel: "Windows",
          steamDepotPath: ".",
          recursive: true,
          sortOrder: 0
        }
      ]
    });

    const steamScripts: string[] = [];
    const runner: CommandRunner = async (command, args, _options, onLine) => {
      expect(command).toBe(steamCmdPath);
      steamScripts.push(fs.readFileSync(args[3], "utf8"));
      onLine("system", steamScripts.length === 1 ? "Steam preview complete." : "BuildID 456789 complete.");
      return { exitCode: 0, signal: null, lines: [] };
    };

    const pipeline = new ReleasePipeline(db, appData, () => undefined, runner);
    const run = pipeline.startRelease(profile.id);
    await waitFor(() => db.getRun(run.id), (value) => value?.status === "completed");

    expect(steamScripts).toHaveLength(2);
    expect(steamScripts[0]).not.toContain("SetLive");
    expect(steamScripts[1]).not.toContain("SetLive");

    db.close();
  });

  it("can skip Godot export and stage existing build files", async () => {
    const root = makeTempRoot();
    const contentBuilder = path.join(root, "ContentBuilder");
    const steamCmdPath = path.join(contentBuilder, "builder", "steamcmd.exe");
    const existingBuild = path.join(root, "existing-build", "windows");
    const appData = path.join(root, "app-data");
    fs.mkdirSync(path.dirname(steamCmdPath), { recursive: true });
    fs.mkdirSync(existingBuild, { recursive: true });
    fs.writeFileSync(steamCmdPath, "");
    fs.writeFileSync(path.join(existingBuild, "game.exe"), "binary");
    fs.writeFileSync(path.join(existingBuild, "game.pck"), "pack");

    const db = await AppDatabase.open(path.join(root, "test.sqlite"));
    db.saveSettings({
      contentBuilderPath: contentBuilder,
      godotPath: "",
      defaultExportRoot: "",
      steamAccount: "builder_account"
    });
    const profile = db.saveProfile({
      name: "Clockwork Arena",
      buildMode: "existing_folder",
      steamAppId: "123456",
      godotProjectPath: "",
      testBranch: "beta",
      buildDescriptionTemplate: "{game} {branch}",
      depots: [
        {
          depotId: "123457",
          buildNote: "Existing Windows build",
          exportPreset: "",
          outputPath: existingBuild,
          platformLabel: "Windows",
          steamDepotPath: ".",
          recursive: true,
          sortOrder: 0
        }
      ]
    });

    const scriptKinds: string[] = [];
    const runner: CommandRunner = async (command, args, _options, onLine) => {
      expect(command).toBe(steamCmdPath);
      const scriptPath = args[3];
      const script = fs.readFileSync(scriptPath, "utf8");
      scriptKinds.push(script.includes('"Preview" "1"') ? "preview" : "upload");
      onLine("system", "Steam preview complete.");
      return { exitCode: 0, signal: null, lines: [] };
    };

    const pipeline = new ReleasePipeline(db, appData, () => undefined, runner);
    const run = pipeline.startRelease(profile.id);
    const completedRun = await waitFor(() => db.getRun(run.id), (value) => value?.status === "completed");

    expect(completedRun?.error).toBeNull();
    expect(scriptKinds).toEqual(["preview", "upload"]);
    expect(fs.existsSync(path.join(appData, "release-runs", run.id, "content", "depot_123457", "game.exe"))).toBe(true);
    expect(fs.existsSync(path.join(appData, "release-runs", run.id, "content", "depot_123457", "game.pck"))).toBe(true);
    expect(db.getLogs(run.id).some((log) => log.line.includes("Skipping Godot export"))).toBe(true);

    db.close();
  });

  it("runs queued releases one at a time across profiles", async () => {
    const root = makeTempRoot();
    const contentBuilder = path.join(root, "ContentBuilder");
    const steamCmdPath = path.join(contentBuilder, "builder", "steamcmd.exe");
    const firstBuild = path.join(root, "first-build");
    const secondBuild = path.join(root, "second-build");
    const appData = path.join(root, "app-data");
    fs.mkdirSync(path.dirname(steamCmdPath), { recursive: true });
    fs.mkdirSync(firstBuild, { recursive: true });
    fs.mkdirSync(secondBuild, { recursive: true });
    fs.writeFileSync(steamCmdPath, "");
    fs.writeFileSync(path.join(firstBuild, "game.exe"), "first");
    fs.writeFileSync(path.join(secondBuild, "game.exe"), "second");

    const db = await AppDatabase.open(path.join(root, "test.sqlite"));
    db.saveSettings({
      contentBuilderPath: contentBuilder,
      godotPath: "",
      defaultExportRoot: "",
      steamAccount: "builder_account"
    });

    const firstProfile = db.saveProfile({
      name: "First Game",
      buildMode: "existing_folder",
      steamAppId: "111111",
      godotProjectPath: "",
      testBranch: "",
      buildDescriptionTemplate: "{game}",
      depots: [
        {
          depotId: "111112",
          buildNote: "",
          exportPreset: "",
          outputPath: firstBuild,
          platformLabel: "Windows",
          steamDepotPath: ".",
          recursive: true,
          sortOrder: 0
        }
      ]
    });
    const secondProfile = db.saveProfile({
      name: "Second Game",
      buildMode: "existing_folder",
      steamAppId: "222222",
      godotProjectPath: "",
      testBranch: "",
      buildDescriptionTemplate: "{game}",
      depots: [
        {
          depotId: "222223",
          buildNote: "",
          exportPreset: "",
          outputPath: secondBuild,
          platformLabel: "Windows",
          steamDepotPath: ".",
          recursive: true,
          sortOrder: 0
        }
      ]
    });

    let activeCommands = 0;
    let maxActiveCommands = 0;
    const callOrder: string[] = [];
    const runner: CommandRunner = async (command, args, _options, onLine) => {
      expect(command).toBe(steamCmdPath);
      activeCommands += 1;
      maxActiveCommands = Math.max(maxActiveCommands, activeCommands);
      try {
        const script = fs.readFileSync(args[3], "utf8");
        const app = script.includes('"AppID" "111111"') ? "first" : "second";
        const phase = script.includes('"Preview" "1"') ? "preview" : "upload";
        callOrder.push(`${app}:${phase}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
        onLine("system", phase === "upload" ? `BuildID ${app === "first" ? "111" : "222"} complete.` : "Steam preview complete.");
        return { exitCode: 0, signal: null, lines: [] };
      } finally {
        activeCommands -= 1;
      }
    };

    const pipeline = new ReleasePipeline(db, appData, () => undefined, runner);
    const firstRun = pipeline.startRelease(firstProfile.id);
    const secondRun = pipeline.startRelease(secondProfile.id);

    expect(db.getRun(secondRun.id)?.status).toBe("queued");
    await waitFor(() => db.getRun(firstRun.id), (value) => value?.status === "completed");
    await waitFor(() => db.getRun(secondRun.id), (value) => value?.status === "completed");

    expect(maxActiveCommands).toBe(1);
    expect(callOrder).toEqual(["first:preview", "first:upload", "second:preview", "second:upload"]);

    db.close();
  });

  it("stops pending queued releases after an error", async () => {
    const root = makeTempRoot();
    const contentBuilder = path.join(root, "ContentBuilder");
    const steamCmdPath = path.join(contentBuilder, "builder", "steamcmd.exe");
    const firstBuild = path.join(root, "first-build");
    const secondBuild = path.join(root, "second-build");
    const appData = path.join(root, "app-data");
    fs.mkdirSync(path.dirname(steamCmdPath), { recursive: true });
    fs.mkdirSync(firstBuild, { recursive: true });
    fs.mkdirSync(secondBuild, { recursive: true });
    fs.writeFileSync(steamCmdPath, "");
    fs.writeFileSync(path.join(firstBuild, "game.exe"), "first");
    fs.writeFileSync(path.join(secondBuild, "game.exe"), "second");

    const db = await AppDatabase.open(path.join(root, "test.sqlite"));
    db.saveSettings({
      contentBuilderPath: contentBuilder,
      godotPath: "",
      defaultExportRoot: "",
      steamAccount: "builder_account"
    });

    const firstProfile = db.saveProfile({
      name: "First Game",
      buildMode: "existing_folder",
      steamAppId: "111111",
      godotProjectPath: "",
      testBranch: "",
      buildDescriptionTemplate: "{game}",
      depots: [
        {
          depotId: "111112",
          buildNote: "",
          exportPreset: "",
          outputPath: firstBuild,
          platformLabel: "Windows",
          steamDepotPath: ".",
          recursive: true,
          sortOrder: 0
        }
      ]
    });
    const secondProfile = db.saveProfile({
      name: "Second Game",
      buildMode: "existing_folder",
      steamAppId: "222222",
      godotProjectPath: "",
      testBranch: "",
      buildDescriptionTemplate: "{game}",
      depots: [
        {
          depotId: "222223",
          buildNote: "",
          exportPreset: "",
          outputPath: secondBuild,
          platformLabel: "Windows",
          steamDepotPath: ".",
          recursive: true,
          sortOrder: 0
        }
      ]
    });

    const calls: string[] = [];
    const runner: CommandRunner = async (_command, args) => {
      const script = fs.readFileSync(args[3], "utf8");
      calls.push(script.includes('"AppID" "111111"') ? "first" : "second");
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { exitCode: 6, signal: null, lines: [] };
    };

    const pipeline = new ReleasePipeline(db, appData, () => undefined, runner);
    const firstRun = pipeline.startRelease(firstProfile.id);
    const secondRun = pipeline.startRelease(secondProfile.id);

    await waitFor(() => db.getRun(firstRun.id), (value) => value?.status === "failed");
    const skippedRun = await waitFor(() => db.getRun(secondRun.id), (value) => value?.status === "cancelled");

    expect(calls).toEqual(["first"]);
    expect(skippedRun?.error).toBe("Queue stopped because the previous run did not complete.");

    db.close();
  });
});

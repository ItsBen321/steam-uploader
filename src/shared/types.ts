export type RunStage =
  | "queued"
  | "validating"
  | "exporting"
  | "staging"
  | "previewing"
  | "awaiting_confirmation"
  | "uploading"
  | "completed"
  | "failed"
  | "cancelled";

export type RunStatus = "idle" | "queued" | "running" | "awaiting_confirmation" | "completed" | "failed" | "cancelled";

export type LogSource = "system" | "godot" | "steamcmd" | "stderr";

export type BuildMode = "godot_export" | "existing_folder";

export type PanelId = "setup" | "profile" | "runs" | "log";

export interface Settings {
  contentBuilderPath: string;
  steamCmdPath: string;
  godotPath: string;
  defaultExportRoot: string;
  steamAccount: string;
  updatedAt: string | null;
}

export interface DepotTarget {
  id: string;
  profileId: string;
  depotId: string;
  buildNote: string;
  exportPreset: string;
  outputPath: string;
  platformLabel: string;
  steamDepotPath: string;
  recursive: boolean;
  sortOrder: number;
}

export interface GameProfile {
  id: string;
  name: string;
  buildMode: BuildMode;
  steamAppId: string;
  godotProjectPath: string;
  testBranch: string;
  buildDescriptionTemplate: string;
  createdAt: string;
  updatedAt: string;
  depots: DepotTarget[];
}

export interface ReleaseRun {
  id: string;
  profileId: string;
  status: RunStatus;
  stage: RunStage;
  startedAt: string;
  finishedAt: string | null;
  previewScriptPath: string | null;
  uploadScriptPath: string | null;
  buildId: string | null;
  manifestIds: string[];
  error: string | null;
}

export interface ReleaseLog {
  id: number;
  runId: string;
  timestamp: string;
  source: LogSource;
  line: string;
}

export interface AppSnapshot {
  settings: Settings;
  profiles: GameProfile[];
  runs: ReleaseRun[];
}

export interface SteamCmdLoginShellResult {
  ok: boolean;
  error?: string;
  snapshot: AppSnapshot;
}

export interface SaveSettingsInput {
  contentBuilderPath: string;
  godotPath: string;
  defaultExportRoot: string;
  steamAccount: string;
}

export interface SaveProfileInput {
  id?: string;
  name: string;
  buildMode: BuildMode;
  steamAppId: string;
  godotProjectPath: string;
  testBranch: string;
  buildDescriptionTemplate: string;
  depots: Array<Omit<DepotTarget, "id" | "profileId"> & { id?: string }>;
}

export interface ToolValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface ExportPreset {
  index: number;
  name: string;
  platform: string | null;
  exportPath: string | null;
}

export type PipelineEvent =
  | { type: "run-updated"; run: ReleaseRun }
  | { type: "log"; log: ReleaseLog }
  | { type: "snapshot"; snapshot: AppSnapshot };

export interface SelectPathOptions {
  title: string;
  kind: "file" | "directory";
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface PanelWindowContext {
  panelId: PanelId;
  profileId?: string | null;
  runId?: string | null;
}

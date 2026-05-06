import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSnapshot,
  ExportPreset,
  GameProfile,
  PanelId,
  PanelWindowContext,
  PipelineEvent,
  ReleaseLog,
  ReleaseRun,
  SaveProfileInput,
  SaveSettingsInput,
  SelectPathOptions,
  SteamCmdLoginShellResult
} from "../src/shared/types";

const api = {
  getSnapshot: (): Promise<AppSnapshot> => ipcRenderer.invoke("app:snapshot"),
  saveSettings: (input: SaveSettingsInput): Promise<AppSnapshot> => ipcRenderer.invoke("settings:save", input),
  saveProfile: (input: SaveProfileInput): Promise<GameProfile> => ipcRenderer.invoke("profiles:save", input),
  deleteProfile: (profileId: string): Promise<AppSnapshot> => ipcRenderer.invoke("profiles:delete", profileId),
  getExportPresets: (projectPath: string): Promise<ExportPreset[]> =>
    ipcRenderer.invoke("profiles:exportPresets", projectPath),
  startRelease: (profileId: string): Promise<ReleaseRun> => ipcRenderer.invoke("runs:start", profileId),
  confirmUpload: (runId: string): Promise<ReleaseRun> => ipcRenderer.invoke("runs:confirmUpload", runId),
  cancelRun: (runId: string): Promise<ReleaseRun> => ipcRenderer.invoke("runs:cancel", runId),
  getRunLogs: (runId: string): Promise<ReleaseLog[]> => ipcRenderer.invoke("runs:logs", runId),
  selectPath: (options: SelectPathOptions): Promise<string | null> => ipcRenderer.invoke("dialog:selectPath", options),
  openSteamCmdLoginShell: (input: SaveSettingsInput): Promise<SteamCmdLoginShellResult> =>
    ipcRenderer.invoke("steamcmd:openLoginShell", input),
  openPanelWindow: (context: PanelWindowContext): Promise<boolean> => ipcRenderer.invoke("windows:openPanel", context),
  dockPanelWindow: (panelId: PanelId): Promise<boolean> => ipcRenderer.invoke("windows:dockPanel", panelId),
  onPanelDocked: (callback: (panelId: PanelId) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, panelId: PanelId) => callback(panelId);
    ipcRenderer.on("windows:panelDocked", listener);
    return () => ipcRenderer.removeListener("windows:panelDocked", listener);
  },
  onPipelineEvent: (callback: (event: PipelineEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: PipelineEvent) => callback(event);
    ipcRenderer.on("pipeline:event", listener);
    return () => ipcRenderer.removeListener("pipeline:event", listener);
  }
};

contextBridge.exposeInMainWorld("steamUploader", api);

export type SteamUploaderApi = typeof api;

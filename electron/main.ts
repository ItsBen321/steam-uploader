import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { AppDatabase } from "../src/main/database";
import { ReleasePipeline } from "../src/main/pipeline";
import { openSteamCmdLoginShell } from "../src/main/steamcmdShell";
import { expectedSteamCmdLocation } from "../src/shared/steamcmd";
import type { PanelId, PanelWindowContext, PipelineEvent, SaveProfileInput, SaveSettingsInput, SelectPathOptions } from "../src/shared/types";

let mainWindow: BrowserWindow | null = null;
let database: AppDatabase;
let pipeline: ReleasePipeline;
const panelWindows = new Map<PanelId, BrowserWindow>();

function sendPipelineEvent(event: PipelineEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("pipeline:event", event);
  }
}

function createBrowserWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  return new BrowserWindow({
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    ...options
  });
}

async function loadRenderer(window: BrowserWindow, query?: Record<string, string>): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    await window.loadURL(url.toString());
    return;
  }

  await window.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"), {
    query
  });
}

async function createWindow(): Promise<void> {
  mainWindow = createBrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "Steam Uploader"
  });

  await loadRenderer(mainWindow);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

async function openPanelWindow(context: PanelWindowContext): Promise<void> {
  const existing = panelWindows.get(context.panelId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const titles: Record<PanelId, string> = {
    setup: "Steam Uploader - Setup",
    profile: "Steam Uploader - Game Profile",
    runs: "Steam Uploader - Runs",
    log: "Steam Uploader - Log"
  };
  const panelWindow = createBrowserWindow({
    width: context.panelId === "log" ? 980 : 900,
    height: context.panelId === "setup" ? 620 : 760,
    minWidth: 620,
    minHeight: 420,
    title: titles[context.panelId]
  });

  panelWindows.set(context.panelId, panelWindow);
  panelWindow.on("closed", () => {
    panelWindows.delete(context.panelId);
    mainWindow?.webContents.send("windows:panelDocked", context.panelId);
  });

  await loadRenderer(panelWindow, {
    panel: context.panelId,
    ...(context.profileId ? { profileId: context.profileId } : {}),
    ...(context.runId ? { runId: context.runId } : {})
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:snapshot", () => database.getSnapshot());

  ipcMain.handle("settings:save", (_event, input: SaveSettingsInput) => {
    database.saveSettings(input);
    const snapshot = database.getSnapshot();
    sendPipelineEvent({ type: "snapshot", snapshot });
    return snapshot;
  });

  ipcMain.handle("profiles:save", (_event, input: SaveProfileInput) => {
    const profile = database.saveProfile(input);
    const snapshot = database.getSnapshot();
    sendPipelineEvent({ type: "snapshot", snapshot });
    return profile;
  });

  ipcMain.handle("profiles:delete", (_event, profileId: string) => {
    database.deleteProfile(profileId);
    const snapshot = database.getSnapshot();
    sendPipelineEvent({ type: "snapshot", snapshot });
    return snapshot;
  });

  ipcMain.handle("profiles:exportPresets", (_event, projectPath: string) => pipeline.readExportPresets(projectPath));

  ipcMain.handle("runs:start", (_event, profileId: string) => pipeline.startRelease(profileId));
  ipcMain.handle("runs:confirmUpload", (_event, runId: string) => pipeline.confirmUpload(runId));
  ipcMain.handle("runs:cancel", (_event, runId: string) => pipeline.cancelRun(runId));
  ipcMain.handle("runs:logs", (_event, runId: string) => database.getLogs(runId));

  ipcMain.handle("dialog:selectPath", async (_event, options: SelectPathOptions) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: options.title,
      properties: options.kind === "directory" ? ["openDirectory"] : ["openFile"],
      filters: options.filters
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("steamcmd:openLoginShell", async (_event, input: SaveSettingsInput) => {
    const settings = database.saveSettings(input);
    const snapshot = database.getSnapshot();
    sendPipelineEvent({ type: "snapshot", snapshot });

    if (!settings.contentBuilderPath.trim()) {
      return {
        ok: false,
        error: `Select the Steamworks SDK tools/ContentBuilder folder first. SteamCMD should be at ${expectedSteamCmdLocation()}.`,
        snapshot
      };
    }

    if (!settings.steamCmdPath || !fs.existsSync(settings.steamCmdPath)) {
      return {
        ok: false,
        error: `SteamCMD was not found at ${settings.steamCmdPath || expectedSteamCmdLocation()}. Check that the ContentBuilder path points to the Steamworks SDK tools/ContentBuilder folder.`,
        snapshot
      };
    }

    if (!settings.steamAccount.trim()) {
      return {
        ok: false,
        error: "Enter your Steam account name first, then click the terminal button again.",
        snapshot
      };
    }

    const openError = await openSteamCmdLoginShell(settings, path.join(app.getPath("userData"), "scripts"));
    if (openError) {
      return {
        ok: false,
        error: `Could not open the SteamCMD login terminal: ${openError}`,
        snapshot
      };
    }

    return { ok: true, snapshot };
  });

  ipcMain.handle("windows:openPanel", async (_event, context: PanelWindowContext) => {
    await openPanelWindow(context);
    return true;
  });

  ipcMain.handle("windows:dockPanel", (event, panelId: PanelId) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender);
    const panelWindow = panelWindows.get(panelId);
    if (sourceWindow && sourceWindow === panelWindow) {
      sourceWindow.close();
    } else {
      panelWindow?.close();
    }
    return true;
  });
}

app.whenReady().then(async () => {
  const appDataPath = app.getPath("userData");
  database = await AppDatabase.open(path.join(appDataPath, "steam-uploader.sqlite"));
  pipeline = new ReleasePipeline(database, appDataPath, sendPipelineEvent);
  registerIpcHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  database?.close();
});

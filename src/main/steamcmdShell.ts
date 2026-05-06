import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import type { Settings } from "../shared/types";

function quoteBatch(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function createSteamCmdLoginScript(settings: Settings, scriptsDir: string): string {
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, "steamcmd-login.cmd");
  const workingDir = path.dirname(settings.steamCmdPath);
  const lines = [
    "@echo off",
    "title SteamCMD Login",
    `cd /d ${quoteBatch(workingDir)}`,
    "echo Opening SteamCMD login shell.",
    "echo Complete SteamGuard here if prompted, then close this window when finished.",
    "echo.",
    `${quoteBatch(settings.steamCmdPath)} +login ${quoteBatch(settings.steamAccount)}`,
    "echo.",
    "echo SteamCMD exited with code %ERRORLEVEL%.",
    "pause",
    ""
  ];

  fs.writeFileSync(scriptPath, lines.join("\r\n"), "utf8");
  return scriptPath;
}

export async function openSteamCmdLoginShell(settings: Settings, scriptsDir: string): Promise<string | null> {
  const scriptPath = createSteamCmdLoginScript(settings, scriptsDir);
  const errorMessage = await shell.openPath(scriptPath);
  return errorMessage || null;
}

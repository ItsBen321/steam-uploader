import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { shell } from "electron";
import type { Settings } from "../shared/types";
import { createSteamCmdInvocation, prepareSteamCmdForExecution, steamCmdRuntimeError } from "../shared/steamcmd";

function quoteBatch(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function createWindowsLoginScript(settings: Settings): string[] {
  const workingDir = path.dirname(settings.steamCmdPath);
  return [
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
}

function createPosixLoginScript(settings: Settings, platform: NodeJS.Platform): string[] {
  const workingDir = path.dirname(settings.steamCmdPath);
  const invocation = createSteamCmdInvocation(settings.steamCmdPath, ["+login", settings.steamAccount], platform);
  const command = [invocation.command, ...invocation.args].map(quoteShell).join(" ");

  return [
    "#!/usr/bin/env bash",
    `cd -- ${quoteShell(workingDir)} || exit 1`,
    "printf '%s\\n' 'Opening SteamCMD login shell.'",
    "printf '%s\\n\\n' 'Complete SteamGuard here if prompted, then close this window when finished.'",
    command,
    "status=$?",
    "printf '\\nSteamCMD exited with code %s.\\n' \"$status\"",
    "read -r -p 'Press Enter to close this window...' _",
    "exit \"$status\"",
    ""
  ];
}

export function createSteamCmdLoginScript(
  settings: Settings,
  scriptsDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  prepareSteamCmdForExecution(settings.steamCmdPath, platform);
  fs.mkdirSync(scriptsDir, { recursive: true });
  const isWindows = platform === "win32";
  const scriptPath = path.join(scriptsDir, isWindows ? "steamcmd-login.cmd" : "steamcmd-login.sh");
  const lines = isWindows ? createWindowsLoginScript(settings) : createPosixLoginScript(settings, platform);

  fs.writeFileSync(scriptPath, lines.join(isWindows ? "\r\n" : "\n"), {
    encoding: "utf8",
    mode: isWindows ? undefined : 0o700
  });
  if (!isWindows) {
    fs.chmodSync(scriptPath, 0o700);
  }
  return scriptPath;
}

interface TerminalCommand {
  command: string;
  args: string[];
}

function executableOnPath(command: string): boolean {
  if (command.includes(path.sep)) {
    return fs.existsSync(command);
  }

  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => {
      try {
        fs.accessSync(path.join(entry, command), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

export function linuxTerminalCommands(scriptPath: string): TerminalCommand[] {
  const commands: TerminalCommand[] = [
    { command: "xdg-terminal-exec", args: [scriptPath] },
    { command: "x-terminal-emulator", args: ["-e", scriptPath] },
    { command: "gnome-terminal", args: ["--", scriptPath] },
    { command: "konsole", args: ["-e", scriptPath] },
    { command: "kitty", args: [scriptPath] },
    { command: "alacritty", args: ["-e", scriptPath] },
    { command: "ghostty", args: ["-e", scriptPath] },
    { command: "foot", args: [scriptPath] },
    { command: "wezterm", args: ["start", "--", scriptPath] },
    { command: "xterm", args: ["-e", scriptPath] }
  ];
  const configuredTerminal = process.env.STEAM_UPLOADER_TERMINAL;
  if (!configuredTerminal) {
    return commands;
  }

  const knownCommand = commands.find(({ command }) => command === path.basename(configuredTerminal));
  return [
    knownCommand ? { ...knownCommand, command: configuredTerminal } : { command: configuredTerminal, args: ["-e", scriptPath] },
    ...commands.filter(({ command }) => command !== path.basename(configuredTerminal))
  ];
}

function launchDetached(command: TerminalCommand, cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, { cwd, detached: true, stdio: "ignore" });
    child.once("error", (error) => resolve(error.message));
    child.once("spawn", () => {
      child.unref();
      resolve(null);
    });
  });
}

export async function openSteamCmdLoginShell(
  settings: Settings,
  scriptsDir: string,
  platform: NodeJS.Platform = process.platform
): Promise<string | null> {
  let scriptPath: string;
  try {
    scriptPath = createSteamCmdLoginScript(settings, scriptsDir, platform);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  const runtimeError = steamCmdRuntimeError(settings.steamCmdPath, platform);
  if (runtimeError) {
    return runtimeError;
  }

  if (platform === "win32") {
    const errorMessage = await shell.openPath(scriptPath);
    return errorMessage || null;
  }

  if (platform !== "linux") {
    return `SteamCMD login terminals are not supported on ${platform}. Run ${scriptPath} manually.`;
  }

  const terminal = linuxTerminalCommands(scriptPath).find(({ command }) => executableOnPath(command));
  if (!terminal) {
    return `No supported terminal emulator was found. Run ${scriptPath} manually or set STEAM_UPLOADER_TERMINAL.`;
  }

  return launchDetached(terminal, path.dirname(settings.steamCmdPath));
}

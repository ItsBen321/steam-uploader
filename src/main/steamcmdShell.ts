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

function createWindowsLoginScript(settings: Settings, resultPath?: string): string[] {
  const workingDir = path.dirname(settings.steamCmdPath);
  return [
    "@echo off",
    "title SteamCMD Login",
    `cd /d ${quoteBatch(workingDir)}`,
    "echo Opening SteamCMD login shell.",
    "echo Complete SteamGuard here if prompted. SteamCMD will then exit and save its login token.",
    "echo Keep this window open until SteamCMD has exited.",
    "echo.",
    `${quoteBatch(settings.steamCmdPath)} +login ${quoteBatch(settings.steamAccount)} +quit`,
    'set "steamcmd_status=%ERRORLEVEL%"',
    ...(resultPath ? [`> ${quoteBatch(resultPath)} echo %steamcmd_status%`] : []),
    "echo.",
    "echo SteamCMD exited with code %steamcmd_status%.",
    "pause",
    "exit /b %steamcmd_status%",
    ""
  ];
}

function createPosixLoginScript(settings: Settings, platform: NodeJS.Platform, resultPath?: string): string[] {
  const workingDir = path.dirname(settings.steamCmdPath);
  // SteamCMD must quit normally to persist its login token (see Steamworks' CI/CD login procedure).
  const invocation = createSteamCmdInvocation(settings.steamCmdPath, ["+login", settings.steamAccount, "+quit"], platform);
  const command = [invocation.command, ...invocation.args].map(quoteShell).join(" ");

  return [
    "#!/usr/bin/env bash",
    `cd -- ${quoteShell(workingDir)} || exit 1`,
    "printf '%s\\n' 'Opening SteamCMD login shell.'",
    "printf '%s\\n' 'Complete SteamGuard here if prompted. SteamCMD will then exit and save its login token.'",
    "printf '%s\\n\\n' 'Keep this window open until SteamCMD has exited.'",
    command,
    "status=$?",
    ...(resultPath ? [`printf '%s\\n' "$status" > ${quoteShell(resultPath)}`] : []),
    "printf '\\nSteamCMD exited with code %s.\\n' \"$status\"",
    "read -r -p 'Press Enter to close this window...' _",
    "exit \"$status\"",
    ""
  ];
}

export function createSteamCmdLoginScript(
  settings: Settings,
  scriptsDir: string,
  platform: NodeJS.Platform = process.platform,
  resultPath?: string
): string {
  prepareSteamCmdForExecution(settings.steamCmdPath, platform);
  fs.mkdirSync(scriptsDir, { recursive: true });
  const isWindows = platform === "win32";
  const scriptPath = path.join(scriptsDir, isWindows ? "steamcmd-login.cmd" : "steamcmd-login.sh");
  const lines = isWindows ? createWindowsLoginScript(settings, resultPath) : createPosixLoginScript(settings, platform, resultPath);

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
  platform: NodeJS.Platform = process.platform,
  onLoginSuccess?: () => void
): Promise<string | null> {
  let scriptPath: string;
  let resultPath: string | undefined;
  try {
    if (onLoginSuccess) {
      fs.mkdirSync(scriptsDir, { recursive: true });
      scriptsDir = fs.mkdtempSync(path.join(scriptsDir, "login-"));
      resultPath = path.join(scriptsDir, "result.txt");
    }
    scriptPath = createSteamCmdLoginScript(settings, scriptsDir, platform, resultPath);
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  const runtimeError = steamCmdRuntimeError(settings.steamCmdPath, platform);
  if (runtimeError) {
    return runtimeError;
  }

  if (platform !== "linux" && platform !== "win32") {
    return `SteamCMD login terminals are not supported on ${platform}. Run ${scriptPath} manually.`;
  }

  const terminal = platform === "linux" ? linuxTerminalCommands(scriptPath).find(({ command }) => executableOnPath(command)) : null;
  if (platform === "linux" && !terminal) {
    return `No supported terminal emulator was found. Run ${scriptPath} manually or set STEAM_UPLOADER_TERMINAL.`;
  }

  // Terminal launchers can return before SteamCMD exits. The script reports the
  // result after SteamCMD saves its token, before waiting for the window to close.
  let stopWatching = () => {};
  if (resultPath && onLoginSuccess) {
    const completionPath = resultPath;
    const poll = setInterval(() => {
      let result: string;
      try {
        result = fs.readFileSync(completionPath, "utf8").trim();
      } catch {
        return;
      }
      if (!/^\d+$/.test(result)) return;
      stopWatching();
      fs.rmSync(completionPath, { force: true });
      if (Number(result) === 0) onLoginSuccess();
    }, 500);
    // Abandoned login windows must not leave a watcher alive indefinitely.
    const timeout = setTimeout(() => stopWatching(), 24 * 60 * 60 * 1000);
    poll.unref?.();
    timeout.unref?.();
    stopWatching = () => {
      clearInterval(poll);
      clearTimeout(timeout);
    };
  }

  try {
    const error = platform === "win32"
      ? await shell.openPath(scriptPath)
      : await launchDetached(terminal!, path.dirname(settings.steamCmdPath));
    if (error) stopWatching();
    return error || null;
  } catch (error: unknown) {
    stopWatching();
    return error instanceof Error ? error.message : String(error);
  }
}

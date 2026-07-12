import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/shared/types";
import { createSteamCmdLoginScript, linuxTerminalCommands } from "../src/main/steamcmdShell";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steam-uploader-shell-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("SteamCMD login script", () => {
  it("writes a visible console script that runs SteamCMD login and pauses", () => {
    const root = tempRoot();
    const settings: Settings = {
      contentBuilderPath: path.join(root, "ContentBuilder"),
      steamCmdPath: path.join(root, "ContentBuilder", "builder", "steamcmd.exe"),
      godotPath: "",
      defaultExportRoot: "",
      steamAccount: "builder_account",
      updatedAt: null
    };

    const scriptPath = createSteamCmdLoginScript(settings, path.join(root, "scripts"), "win32");
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(scriptPath.endsWith("steamcmd-login.cmd")).toBe(true);
    expect(script).toContain("title SteamCMD Login");
    expect(script).toContain(`"${settings.steamCmdPath}" +login "builder_account"`);
    expect(script).toContain("pause");
  });

  it("writes an executable Linux script that runs the SDK wrapper through Bash", () => {
    const root = tempRoot();
    const settings: Settings = {
      contentBuilderPath: path.join(root, "ContentBuilder"),
      steamCmdPath: path.join(root, "ContentBuilder", "builder_linux", "steamcmd.sh"),
      godotPath: "",
      defaultExportRoot: "",
      steamAccount: "builder_account",
      updatedAt: null
    };
    const helperPaths = [
      settings.steamCmdPath,
      path.join(root, "ContentBuilder", "builder_linux", "linux32", "steamcmd"),
      path.join(root, "ContentBuilder", "builder_linux", "linux32", "steamerrorreporter")
    ];
    for (const helperPath of helperPaths) {
      fs.mkdirSync(path.dirname(helperPath), { recursive: true });
      fs.writeFileSync(helperPath, "");
      fs.chmodSync(helperPath, 0o600);
    }
    const chmodSpy = vi.spyOn(fs, "chmodSync");

    const scriptPath = createSteamCmdLoginScript(settings, path.join(root, "scripts"), "linux");
    const script = fs.readFileSync(scriptPath, "utf8");
    const mode = fs.statSync(scriptPath).mode & 0o777;

    expect(scriptPath.endsWith("steamcmd-login.sh")).toBe(true);
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain(`'bash' '${settings.steamCmdPath}' '+login' 'builder_account'`);
    expect(script).toContain("Press Enter to close this window");
    expect(chmodSpy).toHaveBeenCalledWith(scriptPath, 0o700);
    for (const helperPath of helperPaths) {
      expect(chmodSpy.mock.calls.some(([target, targetMode]) => target === helperPath && (Number(targetMode) & 0o100) !== 0)).toBe(true);
    }
    if (process.platform !== "win32") {
      expect(mode).toBe(0o700);
      for (const helperPath of helperPaths) {
        expect(fs.statSync(helperPath).mode & 0o100).toBe(0o100);
      }
    }
  });

  it("uses terminal-specific Linux command arguments", () => {
    vi.stubEnv("STEAM_UPLOADER_TERMINAL", "");
    const commands = linuxTerminalCommands("/tmp/steamcmd-login.sh");

    expect(commands).toContainEqual({ command: "gnome-terminal", args: ["--", "/tmp/steamcmd-login.sh"] });
    expect(commands).toContainEqual({ command: "kitty", args: ["/tmp/steamcmd-login.sh"] });
    expect(commands).toContainEqual({ command: "xterm", args: ["-e", "/tmp/steamcmd-login.sh"] });
  });
});

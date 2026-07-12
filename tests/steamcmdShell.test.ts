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

    const scriptPath = createSteamCmdLoginScript(settings, path.join(root, "scripts"), "linux");
    const script = fs.readFileSync(scriptPath, "utf8");
    const mode = fs.statSync(scriptPath).mode & 0o777;

    expect(scriptPath.endsWith("steamcmd-login.sh")).toBe(true);
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain(`'bash' '${settings.steamCmdPath}' '+login' 'builder_account'`);
    expect(script).toContain("Press Enter to close this window");
    expect(mode).toBe(0o700);
  });

  it("uses terminal-specific Linux command arguments", () => {
    vi.stubEnv("STEAM_UPLOADER_TERMINAL", "");
    const commands = linuxTerminalCommands("/tmp/steamcmd-login.sh");

    expect(commands).toContainEqual({ command: "gnome-terminal", args: ["--", "/tmp/steamcmd-login.sh"] });
    expect(commands).toContainEqual({ command: "kitty", args: ["/tmp/steamcmd-login.sh"] });
    expect(commands).toContainEqual({ command: "xterm", args: ["-e", "/tmp/steamcmd-login.sh"] });
  });
});

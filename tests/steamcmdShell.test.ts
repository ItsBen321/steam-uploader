import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../src/shared/types";
import { shell } from "electron";
import { createSteamCmdLoginScript, linuxTerminalCommands, openSteamCmdLoginShell } from "../src/main/steamcmdShell";

vi.mock("electron", () => ({ shell: { openPath: vi.fn() } }));

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steam-uploader-shell-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.useRealTimers();
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

    const resultPath = path.join(root, "result.txt");
    const scriptPath = createSteamCmdLoginScript(settings, path.join(root, "scripts"), "win32", resultPath);
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(scriptPath.endsWith("steamcmd-login.cmd")).toBe(true);
    expect(script).toContain("title SteamCMD Login");
    expect(script).toContain(`"${settings.steamCmdPath}" +login "builder_account" +quit`);
    expect(script).toContain("pause");
    expect(script).toContain(`> "${resultPath}" echo %steamcmd_status%`);
    expect(script.indexOf(`> "${resultPath}"`)).toBeLessThan(script.indexOf("pause"));
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
    expect(script).toContain(`'bash' '${settings.steamCmdPath}' '+login' 'builder_account' '+quit'`);
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

  it.skipIf(process.platform === "win32").each([0, 5])(
    "waits for SteamCMD to finish and preserves its exit code %i",
    (exitCode) => {
      const root = tempRoot();
      const builderDir = path.join(root, "SDK with spaces", "builder_linux");
      const settings: Settings = {
        contentBuilderPath: path.dirname(builderDir),
        steamCmdPath: path.join(builderDir, "steamcmd.sh"),
        godotPath: "",
        defaultExportRoot: "",
        steamAccount: "builder_account",
        updatedAt: null
      };
      fs.mkdirSync(builderDir, { recursive: true });
      fs.writeFileSync(settings.steamCmdPath, [
        "#!/usr/bin/env bash",
        // Reject extra arguments (including passwords) or a missing graceful quit.
        '[ "$#" -eq 3 ] && [ "$1" = "+login" ] && [ "$2" = "builder_account" ] && [ "$3" = "+quit" ] || exit 99',
        "printf '%s' 'SteamCMD finished' > finished.txt",
        `exit ${exitCode}`
      ].join("\n"));
      const resultPath = path.join(root, "login result.txt");
      const scriptPath = createSteamCmdLoginScript(settings, path.join(root, "scripts"), "linux", resultPath);

      const result = spawnSync("bash", [scriptPath], { input: "\n", encoding: "utf8", timeout: 5000 });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(exitCode);
      expect(fs.readFileSync(resultPath, "utf8").trim()).toBe(String(exitCode));
      expect(fs.readFileSync(path.join(builderDir, "finished.txt"), "utf8")).toBe("SteamCMD finished");
      expect(result.stdout).toContain(`SteamCMD exited with code ${exitCode}.`);
    }
  );

  it.each([0, 5])("only resumes after the login script reports success (exit %i)", async (exitCode) => {
    vi.useFakeTimers();
    const root = tempRoot();
    const settings: Settings = {
      contentBuilderPath: root,
      steamCmdPath: path.join(root, "steamcmd.exe"),
      godotPath: "",
      defaultExportRoot: "",
      steamAccount: "builder_account",
      updatedAt: null
    };
    vi.mocked(shell.openPath).mockResolvedValue("");
    const onSuccess = vi.fn();
    expect(await openSteamCmdLoginShell(settings, path.join(root, "scripts"), "win32", onSuccess)).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSuccess).not.toHaveBeenCalled();

    const scriptPath = vi.mocked(shell.openPath).mock.lastCall![0];
    const resultPath = path.join(path.dirname(scriptPath), "result.txt");
    fs.writeFileSync(resultPath, String(exitCode));
    await vi.advanceTimersByTimeAsync(500);
    expect(onSuccess).toHaveBeenCalledTimes(exitCode === 0 ? 1 : 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSuccess).toHaveBeenCalledTimes(exitCode === 0 ? 1 : 0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops monitoring when the login terminal cannot open", async () => {
    vi.useFakeTimers();
    const root = tempRoot();
    vi.mocked(shell.openPath).mockResolvedValue("Terminal unavailable");
    const onSuccess = vi.fn();
    const error = await openSteamCmdLoginShell({
      contentBuilderPath: root, steamCmdPath: path.join(root, "steamcmd.exe"),
      godotPath: "", defaultExportRoot: "", steamAccount: "builder", updatedAt: null
    }, path.join(root, "scripts"), "win32", onSuccess);
    expect(error).toBe("Terminal unavailable");
    expect(vi.getTimerCount()).toBe(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("uses terminal-specific Linux command arguments", () => {
    vi.stubEnv("STEAM_UPLOADER_TERMINAL", "");
    const commands = linuxTerminalCommands("/tmp/steamcmd-login.sh");

    expect(commands).toContainEqual({ command: "gnome-terminal", args: ["--", "/tmp/steamcmd-login.sh"] });
    expect(commands).toContainEqual({ command: "kitty", args: ["/tmp/steamcmd-login.sh"] });
    expect(commands).toContainEqual({ command: "xterm", args: ["-e", "/tmp/steamcmd-login.sh"] });
  });
});

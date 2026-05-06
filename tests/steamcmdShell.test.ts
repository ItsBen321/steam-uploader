import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Settings } from "../src/shared/types";
import { createSteamCmdLoginScript } from "../src/main/steamcmdShell";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steam-uploader-shell-"));
  roots.push(root);
  return root;
}

afterEach(() => {
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

    const scriptPath = createSteamCmdLoginScript(settings, path.join(root, "scripts"));
    const script = fs.readFileSync(scriptPath, "utf8");

    expect(scriptPath.endsWith("steamcmd-login.cmd")).toBe(true);
    expect(script).toContain("title SteamCMD Login");
    expect(script).toContain(`"${settings.steamCmdPath}" +login "builder_account"`);
    expect(script).toContain("pause");
  });
});

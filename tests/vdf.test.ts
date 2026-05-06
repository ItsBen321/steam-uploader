import { describe, expect, it } from "vitest";
import type { GameProfile } from "../src/shared/types";
import { generateAppBuildScripts, renderBuildDescription } from "../src/shared/vdf";

const profile: GameProfile = {
  id: "profile-1",
  name: "Clockwork Arena",
  buildMode: "godot_export",
  steamAppId: "123456",
  godotProjectPath: "C:\\Games\\Clockwork",
  testBranch: "beta",
  buildDescriptionTemplate: "{game} {branch} {date}",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  depots: [
    {
      id: "depot-1",
      profileId: "profile-1",
      depotId: "123457",
      buildNote: "Public Windows build",
      exportPreset: "Windows Desktop",
      outputPath: "windows/game.exe",
      platformLabel: "Windows",
      steamDepotPath: ".",
      recursive: true,
      sortOrder: 0
    }
  ]
};

describe("SteamPipe VDF generation", () => {
  it("generates preview app scripts without SetLive", () => {
    const scripts = generateAppBuildScripts({
      profile,
      depots: profile.depots,
      contentRoot: "C:\\Steam Upload\\content",
      buildOutput: "C:\\Steam Upload\\output",
      description: "Preview build",
      preview: true
    });

    expect(scripts.appScriptFileName).toBe("preview_app_build_123456.vdf");
    expect(scripts.appScriptContent).toContain('"Preview" "1"');
    expect(scripts.appScriptContent).not.toContain("SetLive");
    expect(scripts.appScriptContent).toContain('"ContentRoot" "C:\\Steam Upload\\content"');
    expect(scripts.depotScripts[0].content).toContain('"LocalPath" "depot_123457\\*"');
    expect(scripts.depotScripts[0].content).toContain('"FileExclusion" "*.pdb"');
  });

  it("generates upload app scripts with a beta branch", () => {
    const scripts = generateAppBuildScripts({
      profile,
      depots: profile.depots,
      contentRoot: "C:\\Steam Upload\\content",
      buildOutput: "C:\\Steam Upload\\output",
      description: "Upload build",
      preview: false,
      setLiveBranch: "beta"
    });

    expect(scripts.appScriptFileName).toBe("upload_app_build_123456.vdf");
    expect(scripts.appScriptContent).not.toContain('"Preview" "1"');
    expect(scripts.appScriptContent).toContain('"SetLive" "beta"');
  });

  it("renders build descriptions from supported tokens", () => {
    const rendered = renderBuildDescription(profile.buildDescriptionTemplate, profile, new Date("2026-05-03T12:00:00.000Z"));
    expect(rendered).toBe("Clockwork Arena beta 2026-05-03 | Build notes: Windows: Public Windows build");
  });

  it("allows the template to place build notes explicitly", () => {
    const rendered = renderBuildDescription("{game}: {buildNotes}", profile, new Date("2026-05-03T12:00:00.000Z"));
    expect(rendered).toBe("Clockwork Arena: Windows: Public Windows build");
  });
});

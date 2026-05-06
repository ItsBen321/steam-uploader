import { describe, expect, it } from "vitest";
import type { GameProfile } from "../src/shared/types";
import { validateProfile } from "../src/shared/validation";

function depot(id: string, depotId: string) {
  return {
    id,
    profileId: "profile-1",
    depotId,
    buildNote: "",
    exportPreset: "Windows Desktop",
    outputPath: "windows/game.exe",
    platformLabel: "Windows",
    steamDepotPath: ".",
    recursive: true,
    sortOrder: 0
  };
}

describe("profile validation", () => {
  it("allows blank test branch to upload without SetLive", () => {
    const profile: GameProfile = {
      id: "profile-1",
      name: "Clockwork Arena",
      buildMode: "existing_folder",
      steamAppId: "123456",
      godotProjectPath: "",
      testBranch: "",
      buildDescriptionTemplate: "{game}",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      depots: [depot("depot-1", "123457")]
    };

    expect(validateProfile(profile).errors).not.toContain("Test branch is required.");
  });

  it("rejects duplicate depot IDs in a single SteamPipe app build", () => {
    const profile: GameProfile = {
      id: "profile-1",
      name: "Clockwork Arena",
      buildMode: "existing_folder",
      steamAppId: "123456",
      godotProjectPath: "",
      testBranch: "beta",
      buildDescriptionTemplate: "{game}",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      depots: [depot("depot-1", "123457"), depot("depot-2", "123457")]
    };

    expect(validateProfile(profile).errors).toContain(
      "Depot ID 123457 appears 2 times. SteamPipe app builds can include each depot ID once, so upload those builds in separate runs/branches or use distinct depot IDs."
    );
  });
});

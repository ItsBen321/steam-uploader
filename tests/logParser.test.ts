import { describe, expect, it } from "vitest";
import { parseSteamLog } from "../src/shared/logParser";

describe("SteamCMD log parsing", () => {
  it("extracts build and manifest IDs", () => {
    const parsed = parseSteamLog([
      "Depot 123 manifest id 98765432101234567",
      "BuildID 456789 completed"
    ]);

    expect(parsed.buildId).toBe("456789");
    expect(parsed.manifestIds).toEqual(["98765432101234567"]);
    expect(parsed.diagnosis).toBeNull();
  });

  it("diagnoses SteamGuard login failures", () => {
    const parsed = parseSteamLog(["Login Failure: Account Login Denied - SteamGuard"]);
    expect(parsed.diagnosis).toContain("Steam login failed");
  });

  it("diagnoses SteamPipe access denied depot builds", () => {
    const parsed = parseSteamLog(["[2026-05-06 11:25:06]: ERROR! Failed to initialize build on server (Access Denied)"]);
    expect(parsed.diagnosis).toContain("Steam denied this depot build");
  });

  it("diagnoses final app build commit failures", () => {
    const parsed = parseSteamLog(["[2026-05-06 11:45:18]: ERROR! Failed to commit build for AppID 3892910 : Failure"]);
    expect(parsed.diagnosis).toContain("failed the final app build commit");
  });
});

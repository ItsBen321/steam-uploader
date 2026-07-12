import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSteamCmdInvocation,
  deriveSteamCmdPath,
  expectedSteamCmdLocation,
  steamCmdCandidates
} from "../src/shared/steamcmd";

describe("SteamCMD platform support", () => {
  it("derives the Windows SDK executable", () => {
    expect(deriveSteamCmdPath("C:\\sdk\\tools\\ContentBuilder", "win32")).toBe(
      path.join("C:\\sdk\\tools\\ContentBuilder", "builder", "steamcmd.exe")
    );
    expect(expectedSteamCmdLocation("win32")).toBe("ContentBuilder\\builder\\steamcmd.exe");
  });

  it("derives the Linux SDK wrapper", () => {
    expect(deriveSteamCmdPath("/opt/steamworks/tools/ContentBuilder", "linux")).toBe(
      "/opt/steamworks/tools/ContentBuilder/builder_linux/steamcmd.sh"
    );
    expect(steamCmdCandidates("/opt/steamworks/tools/ContentBuilder", "linux")).toContain(
      "/opt/steamworks/tools/ContentBuilder/builder_linux/steamcmd"
    );
    expect(expectedSteamCmdLocation("linux")).toBe("ContentBuilder/builder_linux/steamcmd.sh");
  });

  it("runs shell wrappers through Bash on Linux", () => {
    expect(createSteamCmdInvocation("/sdk/builder_linux/steamcmd.sh", ["+quit"], "linux")).toEqual({
      command: "bash",
      args: ["/sdk/builder_linux/steamcmd.sh", "+quit"]
    });
  });

  it("runs native SteamCMD executables directly", () => {
    expect(createSteamCmdInvocation("C:\\sdk\\builder\\steamcmd.exe", ["+quit"], "win32")).toEqual({
      command: "C:\\sdk\\builder\\steamcmd.exe",
      args: ["+quit"]
    });
  });
});

import { describe, expect, it } from "vitest";
import { findMissingExportPresets, parseGodotExportPresets } from "../src/shared/godot";

describe("Godot export preset parsing", () => {
  it("reads preset names, platforms, and export paths", () => {
    const presets = parseGodotExportPresets(`
[preset.0]
name="Windows Desktop"
platform="Windows Desktop"
export_path="../exports/windows/game.exe"

[preset.1]
name="Linux"
platform="Linux/X11"
export_path="../exports/linux/game.x86_64"
`);

    expect(presets).toEqual([
      {
        index: 0,
        name: "Windows Desktop",
        platform: "Windows Desktop",
        exportPath: "../exports/windows/game.exe"
      },
      {
        index: 1,
        name: "Linux",
        platform: "Linux/X11",
        exportPath: "../exports/linux/game.x86_64"
      }
    ]);
  });

  it("reports missing preset names", () => {
    const presets = parseGodotExportPresets('[preset.0]\nname="Windows Desktop"\n');
    expect(findMissingExportPresets(["Windows Desktop", "macOS"], presets)).toEqual(["macOS"]);
  });
});

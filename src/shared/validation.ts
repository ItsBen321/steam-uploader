import fs from "node:fs";
import path from "node:path";
import type { GameProfile, Settings, ToolValidation } from "./types";
import { expectedSteamCmdLocation } from "./steamcmd";

export { deriveSteamCmdPath } from "./steamcmd";

export function validateTools(settings: Settings, options: { requireGodot?: boolean } = {}): ToolValidation {
  const requireGodot = options.requireGodot ?? true;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!settings.contentBuilderPath || !fs.existsSync(settings.contentBuilderPath)) {
    errors.push("Steamworks ContentBuilder path is missing.");
  }

  if (!settings.steamCmdPath || !fs.existsSync(settings.steamCmdPath)) {
    errors.push(`SteamCMD was not found at ${expectedSteamCmdLocation()}.`);
  }

  if (requireGodot && (!settings.godotPath || !fs.existsSync(settings.godotPath))) {
    errors.push("Godot executable path is missing.");
  }

  if (!settings.defaultExportRoot) {
    warnings.push("Default export root is not set. Depot output paths must be absolute or relative to each Godot project.");
  }

  if (!settings.steamAccount.trim()) {
    errors.push("Steam account name is required for cached SteamCMD login.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateProfile(profile: GameProfile): ToolValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!profile.name.trim()) {
    errors.push("Game name is required.");
  }

  if (!/^\d+$/.test(profile.steamAppId.trim())) {
    errors.push("Steam app ID must be numeric.");
  }

  if (profile.buildMode === "godot_export" && (!profile.godotProjectPath || !fs.existsSync(path.join(profile.godotProjectPath, "project.godot")))) {
    errors.push("Godot project path must contain project.godot.");
  }

  if (profile.testBranch.trim().toLowerCase() === "default") {
    errors.push("The default branch cannot be set live automatically. Leave the beta branch blank to upload without SetLive, or choose a beta/test branch.");
  }

  if (profile.depots.length === 0) {
    errors.push("At least one depot target is required.");
  }

  const depotIdCounts = new Map<string, number>();
  for (const depot of profile.depots) {
    const depotId = depot.depotId.trim();
    if (depotId) {
      depotIdCounts.set(depotId, (depotIdCounts.get(depotId) ?? 0) + 1);
    }

    if (!/^\d+$/.test(depot.depotId.trim())) {
      errors.push(`Depot ${depot.platformLabel || depot.id} must have a numeric depot ID.`);
    }

    if (profile.buildMode === "godot_export" && !depot.exportPreset.trim()) {
      errors.push(`Depot ${depot.depotId || depot.platformLabel || depot.id} needs a Godot export preset.`);
    }

    if (!depot.outputPath.trim()) {
      errors.push(`Depot ${depot.depotId || depot.platformLabel || depot.id} needs an ${profile.buildMode === "godot_export" ? "output" : "existing build source"} path.`);
    }

    if (!depot.platformLabel.trim()) {
      warnings.push(`Depot ${depot.depotId || depot.id} has no platform label.`);
    }
  }

  for (const [depotId, count] of depotIdCounts.entries()) {
    if (count > 1) {
      errors.push(`Depot ID ${depotId} appears ${count} times. SteamPipe app builds can include each depot ID once, so upload those builds in separate runs/branches or use distinct depot IDs.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

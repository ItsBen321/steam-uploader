import path from "node:path";
import type { DepotTarget, GameProfile } from "./types";

export interface VdfDepotScript {
  depotId: string;
  fileName: string;
  content: string;
}

export interface VdfBuildScripts {
  appScriptFileName: string;
  appScriptContent: string;
  depotScripts: VdfDepotScript[];
}

export interface BuildScriptOptions {
  profile: GameProfile;
  depots: DepotTarget[];
  contentRoot: string;
  buildOutput: string;
  description: string;
  preview: boolean;
  setLiveBranch?: string;
}

function vdfEscape(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function q(value: string | number | boolean): string {
  return `"${vdfEscape(String(value))}"`;
}

function normalizeSteamPath(value: string): string {
  return value.replace(/\//g, "\\");
}

function depotScriptFileName(depotId: string): string {
  return `depot_build_${depotId}.vdf`;
}

export function generateDepotBuildScript(depot: DepotTarget): VdfDepotScript {
  const localPath = normalizeSteamPath(path.win32.join(`depot_${depot.depotId}`, "*"));
  const depotPath = depot.steamDepotPath.trim() || ".";
  const recursive = depot.recursive ? "1" : "0";

  return {
    depotId: depot.depotId,
    fileName: depotScriptFileName(depot.depotId),
    content: [
      `"DepotBuild"`,
      `{`,
      `    "DepotID" ${q(depot.depotId)}`,
      `    "FileMapping"`,
      `    {`,
      `        "LocalPath" ${q(localPath)}`,
      `        "DepotPath" ${q(depotPath)}`,
      `        "Recursive" ${q(recursive)}`,
      `    }`,
      `    "FileExclusion" "*.pdb"`,
      `}`,
      ``
    ].join("\n")
  };
}

export function generateAppBuildScripts(options: BuildScriptOptions): VdfBuildScripts {
  const depotScripts = options.depots.map(generateDepotBuildScript);
  const appScriptFileName = `${options.preview ? "preview" : "upload"}_app_build_${options.profile.steamAppId}.vdf`;
  const appLines = [
    `"AppBuild"`,
    `{`,
    `    "AppID" ${q(options.profile.steamAppId)}`,
    `    "Desc" ${q(options.description)}`,
    ...(options.preview ? [`    "Preview" "1"`] : []),
    ...(!options.preview && options.setLiveBranch ? [`    "SetLive" ${q(options.setLiveBranch)}`] : []),
    `    "ContentRoot" ${q(options.contentRoot)}`,
    `    "BuildOutput" ${q(options.buildOutput)}`,
    `    "Depots"`,
    `    {`,
    ...depotScripts.map((script) => `        ${q(script.depotId)} ${q(script.fileName)}`),
    `    }`,
    `}`,
    ``
  ];

  return {
    appScriptFileName,
    appScriptContent: appLines.join("\n"),
    depotScripts
  };
}

export function renderBuildDescription(template: string, profile: GameProfile, now = new Date()): string {
  const fallback = `${profile.name} ${now.toISOString()}`;
  const source = template.trim() || fallback;
  const buildNoteSummary = renderBuildNoteSummary(profile.depots);
  const rendered = source
    .replaceAll("{game}", profile.name)
    .replaceAll("{appId}", profile.steamAppId)
    .replaceAll("{branch}", profile.testBranch)
    .replaceAll("{buildNotes}", buildNoteSummary)
    .replaceAll("{depots}", buildNoteSummary)
    .replaceAll("{date}", now.toISOString().slice(0, 10))
    .replaceAll("{datetime}", now.toISOString());

  if (!source.includes("{depots}") && !source.includes("{buildNotes}") && buildNoteSummary) {
    return `${rendered} | Build notes: ${buildNoteSummary}`;
  }

  return rendered;
}

export function renderBuildNoteSummary(depots: DepotTarget[]): string {
  return depots
    .map((depot) => {
      const buildNote = depot.buildNote.trim();
      if (!buildNote) {
        return "";
      }

      const label = depot.platformLabel.trim() || depot.depotId;
      return `${label}: ${buildNote}`;
    })
    .filter(Boolean)
    .join("; ");
}

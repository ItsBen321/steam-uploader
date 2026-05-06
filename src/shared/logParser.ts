export interface ParsedSteamLog {
  buildId: string | null;
  manifestIds: string[];
  diagnosis: string | null;
}

const failureRules: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /Failed to initialize build on server\s*\(Access Denied\)|Access Denied/i,
    message: "Steam denied this depot build. Check that the depot ID belongs to this app, Steamworks changes are published, and the build account has permission to upload this app/depot."
  },
  {
    pattern: /Failed to commit build for AppID/i,
    message: "Steam created the depot manifests but failed the final app build commit. If the upload script has SetLive, check that the beta branch exists, is published, and the account can set builds live; otherwise retry because this can also be a Steam backend commit failure."
  },
  {
    pattern: /Login Failure|Account Login Denied|SteamGuard/i,
    message: "Steam login failed. Open the SteamCMD login shell and complete SteamGuard authentication."
  },
  {
    pattern: /Failed to get application info/i,
    message: "Steam could not read this app. Check the app ID and Steam account permissions."
  },
  {
    pattern: /Failed 'DepotBuild|status\s*=\s*6/i,
    message: "Depot build failed. Check depot IDs, app permissions, and mapped content paths."
  },
  {
    pattern: /cannot find|file doesn't exist|No such file|contentroot/i,
    message: "SteamCMD could not find expected content. Check export output paths and generated VDF paths."
  },
  {
    pattern: /Invalid content configuration/i,
    message: "Steam reports invalid content configuration. Check that depots are attached to the branch/package in Steamworks."
  }
];

export function parseSteamLog(lines: string[]): ParsedSteamLog {
  const manifestIds = new Set<string>();
  let buildId: string | null = null;
  let diagnosis: string | null = null;

  for (const line of lines) {
    const buildMatch =
      line.match(/\bBuildID\b[^0-9]*(\d{3,})/i) ??
      line.match(/\bBuild\s+(\d{3,})\s+(?:complete|finished|done)/i) ??
      line.match(/\bAssigned\s+build\s+id\b[^0-9]*(\d{3,})/i);

    if (buildMatch) {
      buildId = buildMatch[1];
    }

    for (const manifestMatch of line.matchAll(/\bmanifest(?:\s+id)?\b[^0-9]*(\d{8,})/gi)) {
      manifestIds.add(manifestMatch[1]);
    }

    if (!diagnosis) {
      diagnosis = failureRules.find((rule) => rule.pattern.test(line))?.message ?? null;
    }
  }

  return {
    buildId,
    manifestIds: [...manifestIds],
    diagnosis
  };
}

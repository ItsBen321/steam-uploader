import fs from "node:fs";
import path from "node:path";

export interface SteamCmdInvocation {
  command: string;
  args: string[];
}

export function steamCmdCandidates(contentBuilderPath: string, platform: NodeJS.Platform = process.platform): string[] {
  if (!contentBuilderPath.trim()) {
    return [];
  }

  if (platform === "linux") {
    return [
      path.join(contentBuilderPath, "builder_linux", "steamcmd.sh"),
      path.join(contentBuilderPath, "builder_linux", "steamcmd")
    ];
  }

  if (platform === "darwin") {
    return [
      path.join(contentBuilderPath, "builder_osx", "steamcmd.sh"),
      path.join(contentBuilderPath, "builder_osx", "steamcmd")
    ];
  }

  return [path.join(contentBuilderPath, "builder", "steamcmd.exe")];
}

export function deriveSteamCmdPath(contentBuilderPath: string, platform: NodeJS.Platform = process.platform): string {
  const candidates = steamCmdCandidates(contentBuilderPath, platform);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0] ?? "";
}

export function createSteamCmdInvocation(
  steamCmdPath: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): SteamCmdInvocation {
  if (platform !== "win32" && steamCmdPath.toLowerCase().endsWith(".sh")) {
    return { command: "bash", args: [steamCmdPath, ...args] };
  }

  return { command: steamCmdPath, args };
}

export function expectedSteamCmdLocation(platform: NodeJS.Platform = process.platform): string {
  if (platform === "linux") {
    return "ContentBuilder/builder_linux/steamcmd.sh";
  }
  if (platform === "darwin") {
    return "ContentBuilder/builder_osx/steamcmd.sh";
  }
  return "ContentBuilder\\builder\\steamcmd.exe";
}

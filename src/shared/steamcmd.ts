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

  const platformPath = platform === "win32" ? path.win32 : path.posix;

  if (platform === "linux") {
    return [
      platformPath.join(contentBuilderPath, "builder_linux", "steamcmd.sh"),
      platformPath.join(contentBuilderPath, "builder_linux", "steamcmd")
    ];
  }

  if (platform === "darwin") {
    return [
      platformPath.join(contentBuilderPath, "builder_osx", "steamcmd.sh"),
      platformPath.join(contentBuilderPath, "builder_osx", "steamcmd")
    ];
  }

  return [platformPath.join(contentBuilderPath, "builder", "steamcmd.exe")];
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

import fs from "node:fs";
import path from "node:path";

export interface SteamCmdInvocation {
  command: string;
  args: string[];
}

function linuxSteamCmdExecutables(steamCmdPath: string): string[] {
  const builderDir = path.dirname(steamCmdPath);
  return [
    steamCmdPath,
    path.join(builderDir, "linux32", "steamcmd"),
    path.join(builderDir, "linux32", "steamerrorreporter"),
    path.join(builderDir, "linux64", "steamcmd"),
    path.join(builderDir, "linux64", "steamerrorreporter")
  ];
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

export function prepareSteamCmdForExecution(
  steamCmdPath: string,
  platform: NodeJS.Platform = process.platform
): string[] {
  if (platform !== "linux") {
    return [];
  }

  const repairedPaths: string[] = [];
  for (const executablePath of linuxSteamCmdExecutables(steamCmdPath)) {
    if (!fs.existsSync(executablePath)) {
      continue;
    }

    const mode = fs.statSync(executablePath).mode & 0o777;
    if ((mode & 0o100) !== 0) {
      continue;
    }

    try {
      fs.chmodSync(executablePath, mode | 0o100);
      fs.accessSync(executablePath, fs.constants.X_OK);
      repairedPaths.push(executablePath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SteamCMD is not executable and its permissions could not be repaired at ${executablePath}: ${message}`);
    }
  }

  return repairedPaths;
}

export function steamCmdRuntimeError(
  steamCmdPath: string,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform !== "linux") {
    return null;
  }

  const linux32SteamCmd = path.join(path.dirname(steamCmdPath), "linux32", "steamcmd");
  if (!fs.existsSync(linux32SteamCmd) || fs.existsSync("/lib/ld-linux.so.2")) {
    return null;
  }

  return "SteamCMD requires the 32-bit Linux runtime, but /lib/ld-linux.so.2 is missing. Install it and try again (Arch: sudo pacman -S --needed lib32-gcc-libs; Debian/Ubuntu: sudo apt install lib32gcc-s1).";
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

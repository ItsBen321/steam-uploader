import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { LogSource } from "../shared/types";

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  windowsHide?: boolean;
}

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  lines: string[];
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: CommandOptions,
  onLine: (source: LogSource, line: string) => void
) => Promise<CommandResult>;

function streamLines(
  child: ChildProcessWithoutNullStreams,
  streamName: "stdout" | "stderr",
  source: LogSource,
  lines: string[],
  onLine: (source: LogSource, line: string) => void
): void {
  const reader = readline.createInterface({ input: child[streamName] });
  reader.on("line", (line) => {
    lines.push(line);
    onLine(source, line);
  });
}

export const runCommand: CommandRunner = (command, args, options, onLine) =>
  new Promise((resolve, reject) => {
    const lines: string[] = [];
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: options.windowsHide ?? true
      });
    } catch (error) {
      reject(error);
      return;
    }

    const abort = () => {
      if (!child.killed) {
        child.kill();
      }
    };

    if (options.signal?.aborted) {
      abort();
    } else {
      options.signal?.addEventListener("abort", abort, { once: true });
    }

    streamLines(child, "stdout", "system", lines, onLine);
    streamLines(child, "stderr", "stderr", lines, onLine);

    child.on("error", (error) => {
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      options.signal?.removeEventListener("abort", abort);
      resolve({ exitCode, signal, lines });
    });
  });

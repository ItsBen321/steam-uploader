import type { ExportPreset } from "./types";

type SectionMap = Map<string, string>;

function unquoteIniValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  return trimmed;
}

export function parseGodotExportPresets(content: string): ExportPreset[] {
  const sections = new Map<number, SectionMap>();
  let currentIndex: number | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }

    const sectionMatch = line.match(/^\[preset\.(\d+)]$/);
    if (sectionMatch) {
      currentIndex = Number(sectionMatch[1]);
      if (!sections.has(currentIndex)) {
        sections.set(currentIndex, new Map());
      }
      continue;
    }

    if (currentIndex === null) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = unquoteIniValue(line.slice(equalsIndex + 1));
    sections.get(currentIndex)?.set(key, value);
  }

  return [...sections.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, values]) => ({
      index,
      name: values.get("name") ?? `Preset ${index}`,
      platform: values.get("platform") ?? null,
      exportPath: values.get("export_path") ?? null
    }));
}

export function findMissingExportPresets(requiredPresets: string[], availablePresets: ExportPreset[]): string[] {
  const available = new Set(availablePresets.map((preset) => preset.name));
  return requiredPresets.filter((preset) => !available.has(preset));
}

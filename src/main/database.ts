import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import { randomUUID } from "node:crypto";
import type {
  AppSnapshot,
  DepotTarget,
  GameProfile,
  LogSource,
  ReleaseLog,
  ReleaseRun,
  RunStage,
  RunStatus,
  SaveProfileInput,
  SaveSettingsInput,
  Settings
} from "../shared/types";
import { deriveSteamCmdPath } from "../shared/validation";

const DEFAULT_SETTINGS: Settings = {
  contentBuilderPath: "",
  steamCmdPath: "",
  godotPath: "",
  defaultExportRoot: "",
  steamAccount: "",
  updatedAt: null
};

function nowIso(): string {
  return new Date().toISOString();
}

function resolveSqlWasm(file: string): string {
  const candidates = [
    path.join(process.resourcesPath ?? "", file),
    path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
    path.join(__dirname, "..", "node_modules", "sql.js", "dist", file),
    path.join(__dirname, "..", "..", "node_modules", "sql.js", "dist", file)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function rowToSettings(row: Record<string, unknown> | null): Settings {
  if (!row) {
    return DEFAULT_SETTINGS;
  }

  return {
    contentBuilderPath: String(row.content_builder_path ?? ""),
    steamCmdPath: String(row.steamcmd_path ?? ""),
    godotPath: String(row.godot_path ?? ""),
    defaultExportRoot: String(row.default_export_root ?? ""),
    steamAccount: String(row.steam_account ?? ""),
    updatedAt: row.updated_at ? String(row.updated_at) : null
  };
}

function rowToDepot(row: Record<string, unknown>): DepotTarget {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    depotId: String(row.depot_id),
    buildNote: String(row.build_note ?? row.depot_description ?? ""),
    exportPreset: String(row.export_preset),
    outputPath: String(row.output_path),
    platformLabel: String(row.platform_label),
    steamDepotPath: String(row.steam_depot_path),
    recursive: Number(row.recursive) === 1,
    sortOrder: Number(row.sort_order)
  };
}

function rowToRun(row: Record<string, unknown>): ReleaseRun {
  return {
    id: String(row.id),
    profileId: String(row.profile_id),
    status: String(row.status) as RunStatus,
    stage: String(row.stage) as RunStage,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    previewScriptPath: row.preview_script_path ? String(row.preview_script_path) : null,
    uploadScriptPath: row.upload_script_path ? String(row.upload_script_path) : null,
    buildId: row.build_id ? String(row.build_id) : null,
    manifestIds: row.manifest_ids_json ? (JSON.parse(String(row.manifest_ids_json)) as string[]) : [],
    error: row.error ? String(row.error) : null
  };
}

function rowToLog(row: Record<string, unknown>): ReleaseLog {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    timestamp: String(row.timestamp),
    source: String(row.source) as LogSource,
    line: String(row.line)
  };
}

export class AppDatabase {
  private constructor(
    private readonly databasePath: string,
    private readonly db: Database
  ) {}

  static async open(databasePath: string): Promise<AppDatabase> {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const SQL: SqlJsStatic = await initSqlJs({ locateFile: resolveSqlWasm });
    const db = fs.existsSync(databasePath)
      ? new SQL.Database(fs.readFileSync(databasePath))
      : new SQL.Database();
    const instance = new AppDatabase(databasePath, db);
    instance.migrate();
    instance.save();
    return instance;
  }

  close(): void {
    this.save();
    this.db.close();
  }

  getSnapshot(): AppSnapshot {
    return {
      settings: this.getSettings(),
      profiles: this.getProfiles(),
      runs: this.getRuns()
    };
  }

  getSettings(): Settings {
    const row = this.first("SELECT * FROM settings WHERE id = 1");
    return rowToSettings(row);
  }

  saveSettings(input: SaveSettingsInput): Settings {
    const updatedAt = nowIso();
    const steamCmdPath = deriveSteamCmdPath(input.contentBuilderPath);

    this.db.run(
      `
        INSERT INTO settings (id, content_builder_path, steamcmd_path, godot_path, default_export_root, steam_account, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content_builder_path = excluded.content_builder_path,
          steamcmd_path = excluded.steamcmd_path,
          godot_path = excluded.godot_path,
          default_export_root = excluded.default_export_root,
          steam_account = excluded.steam_account,
          updated_at = excluded.updated_at
      `,
      [
        input.contentBuilderPath.trim(),
        steamCmdPath,
        input.godotPath.trim(),
        input.defaultExportRoot.trim(),
        input.steamAccount.trim(),
        updatedAt
      ]
    );

    this.save();
    return this.getSettings();
  }

  getProfiles(): GameProfile[] {
    const profileRows = this.all("SELECT * FROM profiles ORDER BY name COLLATE NOCASE");
    const depots = this.all("SELECT * FROM depots ORDER BY sort_order, platform_label COLLATE NOCASE").map(rowToDepot);

    return profileRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      buildMode: String(row.build_mode ?? "godot_export") === "existing_folder" ? "existing_folder" : "godot_export",
      steamAppId: String(row.steam_app_id),
      godotProjectPath: String(row.godot_project_path),
      testBranch: String(row.test_branch),
      buildDescriptionTemplate: String(row.build_description_template),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      depots: depots.filter((depot) => depot.profileId === String(row.id))
    }));
  }

  getProfile(profileId: string): GameProfile | null {
    return this.getProfiles().find((profile) => profile.id === profileId) ?? null;
  }

  saveProfile(input: SaveProfileInput): GameProfile {
    const id = input.id ?? randomUUID();
    const existing = this.first("SELECT id, created_at FROM profiles WHERE id = ?", [id]);
    const createdAt = existing ? String(existing.created_at) : nowIso();
    const updatedAt = nowIso();

    this.db.run(
      `
        INSERT INTO profiles (id, name, build_mode, steam_app_id, godot_project_path, test_branch, build_description_template, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          build_mode = excluded.build_mode,
          steam_app_id = excluded.steam_app_id,
          godot_project_path = excluded.godot_project_path,
          test_branch = excluded.test_branch,
          build_description_template = excluded.build_description_template,
          updated_at = excluded.updated_at
      `,
      [
        id,
        input.name.trim(),
        input.buildMode,
        input.steamAppId.trim(),
        input.godotProjectPath.trim(),
        input.testBranch.trim(),
        input.buildDescriptionTemplate.trim(),
        createdAt,
        updatedAt
      ]
    );

    this.db.run("DELETE FROM depots WHERE profile_id = ?", [id]);

    input.depots.forEach((depot, index) => {
      this.db.run(
        `
          INSERT INTO depots (id, profile_id, depot_id, build_note, export_preset, output_path, platform_label, steam_depot_path, recursive, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          depot.id ?? randomUUID(),
          id,
          depot.depotId.trim(),
          depot.buildNote.trim(),
          depot.exportPreset.trim(),
          depot.outputPath.trim(),
          depot.platformLabel.trim(),
          depot.steamDepotPath.trim() || ".",
          depot.recursive ? 1 : 0,
          depot.sortOrder ?? index
        ]
      );
    });

    this.save();
    const profile = this.getProfile(id);
    if (!profile) {
      throw new Error("Profile save failed.");
    }

    return profile;
  }

  deleteProfile(profileId: string): void {
    this.db.run("DELETE FROM release_logs WHERE run_id IN (SELECT id FROM release_runs WHERE profile_id = ?)", [profileId]);
    this.db.run("DELETE FROM release_runs WHERE profile_id = ?", [profileId]);
    this.db.run("DELETE FROM depots WHERE profile_id = ?", [profileId]);
    this.db.run("DELETE FROM profiles WHERE id = ?", [profileId]);
    this.save();
  }

  createRun(profileId: string): ReleaseRun {
    const run: ReleaseRun = {
      id: randomUUID(),
      profileId,
      status: "queued",
      stage: "queued",
      startedAt: nowIso(),
      finishedAt: null,
      previewScriptPath: null,
      uploadScriptPath: null,
      buildId: null,
      manifestIds: [],
      error: null
    };

    this.db.run(
      `
        INSERT INTO release_runs
          (id, profile_id, status, stage, started_at, finished_at, preview_script_path, upload_script_path, build_id, manifest_ids_json, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        run.id,
        run.profileId,
        run.status,
        run.stage,
        run.startedAt,
        run.finishedAt,
        run.previewScriptPath,
        run.uploadScriptPath,
        run.buildId,
        JSON.stringify(run.manifestIds),
        run.error
      ]
    );

    this.save();
    return run;
  }

  getRuns(profileId?: string): ReleaseRun[] {
    const rows = profileId
      ? this.all("SELECT * FROM release_runs WHERE profile_id = ? ORDER BY started_at DESC", [profileId])
      : this.all("SELECT * FROM release_runs ORDER BY started_at DESC LIMIT 100");
    return rows.map(rowToRun);
  }

  getRun(runId: string): ReleaseRun | null {
    const row = this.first("SELECT * FROM release_runs WHERE id = ?", [runId]);
    return row ? rowToRun(row) : null;
  }

  updateRun(runId: string, patch: Partial<Omit<ReleaseRun, "id" | "profileId" | "startedAt">>): ReleaseRun {
    const current = this.getRun(runId);
    if (!current) {
      throw new Error(`Unknown run ${runId}`);
    }

    const next = {
      ...current,
      ...patch
    };

    this.db.run(
      `
        UPDATE release_runs SET
          status = ?,
          stage = ?,
          finished_at = ?,
          preview_script_path = ?,
          upload_script_path = ?,
          build_id = ?,
          manifest_ids_json = ?,
          error = ?
        WHERE id = ?
      `,
      [
        next.status,
        next.stage,
        next.finishedAt,
        next.previewScriptPath,
        next.uploadScriptPath,
        next.buildId,
        JSON.stringify(next.manifestIds),
        next.error,
        runId
      ]
    );

    this.save();
    const updated = this.getRun(runId);
    if (!updated) {
      throw new Error(`Unknown run ${runId}`);
    }
    return updated;
  }

  addLog(runId: string, source: LogSource, line: string): ReleaseLog {
    this.db.run(
      "INSERT INTO release_logs (run_id, timestamp, source, line) VALUES (?, ?, ?, ?)",
      [runId, nowIso(), source, line]
    );
    const row = this.first("SELECT last_insert_rowid() AS id");
    const id = Number(row?.id ?? 0);
    this.save();
    return rowToLog(this.first("SELECT * FROM release_logs WHERE id = ?", [id])!);
  }

  getLogs(runId: string): ReleaseLog[] {
    return this.all("SELECT * FROM release_logs WHERE run_id = ? ORDER BY id ASC", [runId]).map(rowToLog);
  }

  private migrate(): void {
    this.db.run(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        content_builder_path TEXT NOT NULL DEFAULT '',
        steamcmd_path TEXT NOT NULL DEFAULT '',
        godot_path TEXT NOT NULL DEFAULT '',
        default_export_root TEXT NOT NULL DEFAULT '',
        steam_account TEXT NOT NULL DEFAULT '',
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        build_mode TEXT NOT NULL DEFAULT 'godot_export',
        steam_app_id TEXT NOT NULL,
        godot_project_path TEXT NOT NULL,
        test_branch TEXT NOT NULL,
        build_description_template TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS depots (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        depot_id TEXT NOT NULL,
        build_note TEXT NOT NULL DEFAULT '',
        export_preset TEXT NOT NULL,
        output_path TEXT NOT NULL,
        platform_label TEXT NOT NULL,
        steam_depot_path TEXT NOT NULL DEFAULT '.',
        recursive INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS release_runs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        preview_script_path TEXT,
        upload_script_path TEXT,
        build_id TEXT,
        manifest_ids_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS release_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        line TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES release_runs(id) ON DELETE CASCADE
      );
    `);

    this.ensureColumn("profiles", "build_mode", "TEXT NOT NULL DEFAULT 'godot_export'");
    this.ensureColumn("depots", "build_note", "TEXT NOT NULL DEFAULT ''");
  }

  private save(): void {
    const data = this.db.export();
    fs.writeFileSync(this.databasePath, Buffer.from(data));
  }

  private all(sql: string, params: SqlValue[] = []): Array<Record<string, unknown>> {
    const statement = this.db.prepare(sql, params);
    const rows: Array<Record<string, unknown>> = [];
    try {
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }
    return rows;
  }

  private first(sql: string, params: SqlValue[] = []): Record<string, unknown> | null {
    return this.all(sql, params)[0] ?? null;
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.all(`PRAGMA table_info(${table})`);
    if (columns.some((row) => String(row.name) === column)) {
      return;
    }

    this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

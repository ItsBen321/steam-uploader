import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Info,
  ListTree,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  Square,
  Terminal,
  Trash2,
  UploadCloud
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSnapshot,
  DepotTarget,
  ExportPreset,
  GameProfile,
  ReleaseLog,
  ReleaseRun,
  PanelId,
  SaveProfileInput,
  SaveSettingsInput,
  Settings as AppSettings
} from "./shared/types";

type ProfileDraft = SaveProfileInput & { id?: string };
type Notice = { kind: "ok" | "error" | "info"; text: string } | null;

const PANEL_IDS: PanelId[] = ["setup", "profile", "runs", "log"];
const PANEL_LABELS: Record<PanelId, string> = {
  setup: "Setup",
  profile: "Game Profile",
  runs: "Runs",
  log: "Log"
};

const EMPTY_SETTINGS: AppSettings = {
  contentBuilderPath: "",
  steamCmdPath: "",
  godotPath: "",
  defaultExportRoot: "",
  steamAccount: "",
  updatedAt: null
};

function newDepotDraft(sortOrder: number): SaveProfileInput["depots"][number] {
  return {
    id: crypto.randomUUID(),
    depotId: "",
    buildNote: "",
    exportPreset: "",
    outputPath: sortOrder === 0 ? "windows/game.exe" : "",
    platformLabel: sortOrder === 0 ? "Windows" : "",
    steamDepotPath: ".",
    recursive: true,
    sortOrder
  };
}

function newProfileDraft(): ProfileDraft {
  return {
    name: "",
    buildMode: "godot_export",
    steamAppId: "",
    godotProjectPath: "",
    testBranch: "",
    buildDescriptionTemplate: "{game} {datetime}",
    depots: [newDepotDraft(0)]
  };
}

function profileToDraft(profile: GameProfile): ProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    buildMode: profile.buildMode,
    steamAppId: profile.steamAppId,
    godotProjectPath: profile.godotProjectPath,
    testBranch: profile.testBranch,
    buildDescriptionTemplate: profile.buildDescriptionTemplate,
    depots: profile.depots.map((depot) => ({ ...depot }))
  };
}

function formatDate(value: string | null): string {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function runLabel(run: ReleaseRun): string {
  if (run.status === "awaiting_confirmation") {
    return "Waiting to upload";
  }
  return run.stage.replaceAll("_", " ");
}

function setupItems(settings: AppSettings) {
  return [
    {
      label: "ContentBuilder",
      ok: Boolean(settings.contentBuilderPath),
      value: settings.contentBuilderPath
    },
    {
      label: "SteamCMD",
      ok: Boolean(settings.steamCmdPath),
      value: settings.steamCmdPath || "ContentBuilder\\builder\\steamcmd.exe"
    },
    {
      label: "Godot",
      ok: Boolean(settings.godotPath),
      value: settings.godotPath
    },
    {
      label: "Export root",
      ok: Boolean(settings.defaultExportRoot),
      value: settings.defaultExportRoot
    },
    {
      label: "Steam account",
      ok: Boolean(settings.steamAccount),
      value: settings.steamAccount
    }
  ];
}

function FieldLabel({
  title,
  help,
  className,
  children
}: {
  title: string;
  help: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className}>
      <span className="label-title">
        {title}
        <span className="help-icon" title={help} aria-label={`${title} help`}>
          <Info size={13} />
        </span>
      </span>
      <span className="field-help">{help}</span>
      {children}
    </label>
  );
}

export default function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const requestedPanel = searchParams.get("panel");
  const panelMode = PANEL_IDS.includes(requestedPanel as PanelId) ? (requestedPanel as PanelId) : null;
  const requestedProfileId = searchParams.get("profileId");
  const requestedRunId = searchParams.get("runId");
  const [snapshot, setSnapshot] = useState<AppSnapshot>({
    settings: EMPTY_SETTINGS,
    profiles: [],
    runs: []
  });
  const [settingsDraft, setSettingsDraft] = useState<SaveSettingsInput>({
    contentBuilderPath: "",
    godotPath: "",
    defaultExportRoot: "",
    steamAccount: ""
  });
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(requestedProfileId);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(newProfileDraft());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(requestedRunId);
  const [logs, setLogs] = useState<ReleaseLog[]>([]);
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [hiddenPanels, setHiddenPanels] = useState<Set<PanelId>>(() => new Set());
  const selectedRunIdRef = useRef<string | null>(null);
  const logOutputRef = useRef<HTMLDivElement | null>(null);

  const selectedProfile = useMemo(
    () => snapshot.profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [snapshot.profiles, selectedProfileId]
  );
  const selectedRuns = useMemo(
    () => snapshot.runs.filter((run) => run.profileId === selectedProfileId),
    [snapshot.runs, selectedProfileId]
  );
  const activeRun = useMemo(
    () =>
      selectedRuns.find((run) => run.status === "running" || run.status === "awaiting_confirmation") ??
      selectedRuns.find((run) => run.status === "queued") ??
      null,
    [selectedRuns]
  );
  const usesGodotExport = profileDraft.buildMode === "godot_export";

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  useEffect(() => {
    const output = logOutputRef.current;
    if (!output) {
      return;
    }

    output.scrollTop = output.scrollHeight;
  }, [logs.length, selectedRunId]);

  useEffect(() => {
    void window.steamUploader.getSnapshot().then((nextSnapshot) => {
      setSnapshot(nextSnapshot);
      setSettingsDraft({
        contentBuilderPath: nextSnapshot.settings.contentBuilderPath,
        godotPath: nextSnapshot.settings.godotPath,
        defaultExportRoot: nextSnapshot.settings.defaultExportRoot,
        steamAccount: nextSnapshot.settings.steamAccount
      });

      const startupProfile =
        (requestedProfileId ? nextSnapshot.profiles.find((profile) => profile.id === requestedProfileId) : null) ??
        nextSnapshot.profiles[0] ??
        null;

      if (startupProfile) {
        setSelectedProfileId(startupProfile.id);
        setProfileDraft(profileToDraft(startupProfile));
        setSelectedRunId(requestedRunId ?? nextSnapshot.runs.find((run) => run.profileId === startupProfile.id)?.id ?? null);
      }
    });

    return window.steamUploader.onPipelineEvent((event) => {
      if (event.type === "snapshot") {
        setSnapshot(event.snapshot);
      }

      if (event.type === "run-updated") {
        setSnapshot((current) => ({
          ...current,
          runs: [event.run, ...current.runs.filter((run) => run.id !== event.run.id)]
        }));
        setSelectedRunId((current) => current ?? event.run.id);
      }

      if (event.type === "log") {
        setLogs((current) => (event.log.runId === selectedRunIdRef.current ? [...current, event.log] : current));
      }
    });
  }, []);

  useEffect(() => {
    return window.steamUploader.onPanelDocked((panelId) => {
      setHiddenPanels((current) => {
        const next = new Set(current);
        next.delete(panelId);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setLogs([]);
      return;
    }

    void window.steamUploader.getRunLogs(selectedRunId).then(setLogs);
  }, [selectedRunId]);

  async function runAction<T>(action: () => Promise<T>, success?: string): Promise<T | null> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      if (success) {
        setNotice({ kind: "ok", text: success });
      }
      return result;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function selectDirectory(title: string): Promise<string | null> {
    return window.steamUploader.selectPath({ title, kind: "directory" });
  }

  async function selectFile(title: string): Promise<string | null> {
    return window.steamUploader.selectPath({
      title,
      kind: "file",
      filters: [{ name: "Executable", extensions: ["exe", "*"] }]
    });
  }

  async function saveSettings(): Promise<void> {
    const next = await runAction(() => window.steamUploader.saveSettings(settingsDraft), "Settings saved.");
    if (next) {
      setSnapshot(next);
    }
  }

  async function saveProfile(): Promise<GameProfile | null> {
    const saved = await runAction(() => window.steamUploader.saveProfile(profileDraft), "Profile saved.");
    if (saved) {
      setSnapshot((current) => ({
        ...current,
        profiles: [saved, ...current.profiles.filter((profile) => profile.id !== saved.id)].sort((left, right) =>
          left.name.localeCompare(right.name)
        )
      }));
      setSelectedProfileId(saved.id);
      setProfileDraft(profileToDraft(saved));
      return saved;
    }
    return null;
  }

  async function deleteProfile(profileId: string): Promise<void> {
    if (!window.confirm("Delete this game profile and its run history?")) {
      return;
    }

    const next = await runAction(() => window.steamUploader.deleteProfile(profileId), "Profile deleted.");
    if (next) {
      setSnapshot(next);
      const replacement = next.profiles[0] ?? null;
      setSelectedProfileId(replacement?.id ?? null);
      setProfileDraft(replacement ? profileToDraft(replacement) : newProfileDraft());
      setSelectedRunId(null);
    }
  }

  async function refreshPresets(projectPath = profileDraft.godotProjectPath, showNotice = true): Promise<void> {
    if (!projectPath.trim()) {
      setPresets([]);
      return;
    }

    const next = await runAction(() => window.steamUploader.getExportPresets(projectPath), showNotice ? "Presets refreshed." : undefined);
    if (next) {
      setPresets(next);
    }
  }

  async function startRelease(): Promise<void> {
    const saved = await saveProfile();
    if (!saved) {
      return;
    }

    const run = await runAction(
      () => window.steamUploader.startRelease(saved.id),
      "Release run queued. Preview and upload will run automatically."
    );
    if (run) {
      setSelectedRunId(run.id);
      setLogs([]);
    }
  }

  async function openLoginShell(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.steamUploader.openSteamCmdLoginShell(settingsDraft);
      setSnapshot(result.snapshot);
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error ?? "SteamCMD login shell could not be opened." });
        return;
      }
      setNotice({ kind: "ok", text: "SteamCMD login shell opened. Complete SteamGuard there, then return to this app." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function popOutPanel(panelId: PanelId): Promise<void> {
    await window.steamUploader.openPanelWindow({
      panelId,
      profileId: selectedProfileId,
      runId: selectedRunId
    });
    setHiddenPanels((current) => new Set(current).add(panelId));
  }

  async function dockPanel(panelId: PanelId): Promise<void> {
    if (panelMode) {
      await window.steamUploader.dockPanelWindow(panelId);
      return;
    }

    setHiddenPanels((current) => {
      const next = new Set(current);
      next.delete(panelId);
      return next;
    });
  }

  function hidePanel(panelId: PanelId): void {
    setHiddenPanels((current) => new Set(current).add(panelId));
  }

  function panelControls(panelId: PanelId): ReactNode {
    if (panelMode) {
      return (
        <button className="panel-tool-button" onClick={() => dockPanel(panelId)} title="Dock back into the main window">
          <Eye size={14} />
        </button>
      );
    }

    return (
      <>
        <button className="panel-tool-button" onClick={() => popOutPanel(panelId)} title="Open this panel in a separate window">
          <ExternalLink size={14} />
        </button>
        <button className="panel-tool-button" onClick={() => hidePanel(panelId)} title="Hide this panel">
          <EyeOff size={14} />
        </button>
      </>
    );
  }

  function panelHeading(panelId: PanelId, icon: ReactNode): ReactNode {
    return (
      <div className="section-heading">
        <div className="heading-title">
          {icon}
          <h3>{PANEL_LABELS[panelId]}</h3>
        </div>
        <div className="panel-tools">{panelControls(panelId)}</div>
      </div>
    );
  }

  function beginNewProfile(): void {
    setSelectedProfileId(null);
    setProfileDraft(newProfileDraft());
    setSelectedRunId(null);
    setLogs([]);
    setPresets([]);
    setNotice(null);
  }

  function selectProfile(profile: GameProfile): void {
    setSelectedProfileId(profile.id);
    setProfileDraft(profileToDraft(profile));
    setSelectedRunId(snapshot.runs.find((run) => run.profileId === profile.id)?.id ?? null);
    setNotice(null);
    void refreshPresets(profile.godotProjectPath, false);
  }

  function updateDepot(index: number, patch: Partial<SaveProfileInput["depots"][number]>): void {
    setProfileDraft((current) => ({
      ...current,
      depots: current.depots.map((depot, depotIndex) =>
        depotIndex === index ? { ...depot, ...patch } : depot
      )
    }));
  }

  function removeDepot(index: number): void {
    setProfileDraft((current) => ({
      ...current,
      depots: current.depots.filter((_depot, depotIndex) => depotIndex !== index)
    }));
  }

  return (
    <div className={`app-shell ${panelMode ? `popout-mode panel-${panelMode}` : ""}`}>
      <aside className="sidebar">
        <div className="brand-row">
          <UploadCloud size={24} />
          <div>
            <h1>Steam Uploader</h1>
            <span>Godot to SteamPipe</span>
          </div>
        </div>

        <button className="primary-action" onClick={beginNewProfile}>
          <Plus size={17} />
          New game
        </button>

        <nav className="profile-list" aria-label="Game profiles">
          {snapshot.profiles.map((profile) => (
            <button
              className={`profile-card ${profile.id === selectedProfileId ? "selected" : ""}`}
              key={profile.id}
              onClick={() => selectProfile(profile)}
            >
              <strong>{profile.name || "Untitled game"}</strong>
              <span>App {profile.steamAppId || "unset"}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="main-grid">
        <section className="topbar">
          <div>
            <h2>{profileDraft.name || "New game profile"}</h2>
            <span>{activeRun ? runLabel(activeRun) : "Idle"}</span>
          </div>
          <div className="toolbar">
            <button className="ghost-button" onClick={saveSettings} disabled={busy}>
              <Settings size={16} />
              Save settings
            </button>
            <button className="ghost-button" onClick={saveProfile} disabled={busy}>
              <Save size={16} />
              Save profile
            </button>
            <button className="run-button" onClick={startRelease} disabled={busy || Boolean(activeRun)}>
              <Play size={17} />
              Queue run
            </button>
          </div>
        </section>

        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

        {!panelMode && hiddenPanels.size > 0 && (
          <div className="panel-restore-bar">
            <span>Hidden panels</span>
            {[...hiddenPanels].map((panelId) => (
              <button key={panelId} className="ghost-button" onClick={() => dockPanel(panelId)}>
                <Eye size={15} />
                {PANEL_LABELS[panelId]}
              </button>
            ))}
          </div>
        )}

        {!hiddenPanels.has("setup") && (
        <section className="setup-panel resizable-panel">
          {panelHeading("setup", <Settings size={18} />)}
          <div className="checklist">
            {setupItems(snapshot.settings).map((item) => (
              <div className="check-item" key={item.label}>
                {item.ok ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.value || "Not set"}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="settings-grid">
            <FieldLabel
              title="ContentBuilder path"
              help="Select the Steamworks SDK tools/ContentBuilder folder. SteamCMD is expected at builder/steamcmd.exe inside it."
            >
              <div className="path-input">
                <input
                  aria-label="ContentBuilder path"
                  placeholder="C:\\SteamworksSDK\\tools\\ContentBuilder"
                  value={settingsDraft.contentBuilderPath}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, contentBuilderPath: event.target.value })}
                />
                <button onClick={async () => {
                  const selected = await selectDirectory("Select Steamworks ContentBuilder folder");
                  if (selected) setSettingsDraft({ ...settingsDraft, contentBuilderPath: selected });
                }}>
                  <FolderOpen size={16} />
                </button>
              </div>
            </FieldLabel>
            <FieldLabel
              title="Godot executable"
              help="Select your Godot editor executable. The app runs it headlessly with --export-release."
            >
              <div className="path-input">
                <input
                  aria-label="Godot executable"
                  placeholder="C:\\Tools\\Godot_v4.x-stable_win64.exe"
                  value={settingsDraft.godotPath}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, godotPath: event.target.value })}
                />
                <button onClick={async () => {
                  const selected = await selectFile("Select Godot executable");
                  if (selected) setSettingsDraft({ ...settingsDraft, godotPath: selected });
                }}>
                  <FolderOpen size={16} />
                </button>
              </div>
            </FieldLabel>
            <FieldLabel
              title="Default export root"
              help="Base folder for relative depot output paths. Example: C:\\Builds\\Steam."
            >
              <div className="path-input">
                <input
                  aria-label="Default export root"
                  placeholder="C:\\Builds\\Steam"
                  value={settingsDraft.defaultExportRoot}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, defaultExportRoot: event.target.value })}
                />
                <button onClick={async () => {
                  const selected = await selectDirectory("Select default export root");
                  if (selected) setSettingsDraft({ ...settingsDraft, defaultExportRoot: selected });
                }}>
                  <FolderOpen size={16} />
                </button>
              </div>
            </FieldLabel>
            <FieldLabel
              title="Steam account"
              help="Steamworks account name used by SteamCMD. Passwords are not stored; use the terminal button for cached SteamGuard login."
            >
              <div className="path-input">
                <input
                  aria-label="Steam account"
                  placeholder="your_steamworks_login"
                  value={settingsDraft.steamAccount}
                  onChange={(event) => setSettingsDraft({ ...settingsDraft, steamAccount: event.target.value })}
                />
                <button onClick={openLoginShell} title="Save these settings and open SteamCMD login">
                  <Terminal size={16} />
                </button>
              </div>
            </FieldLabel>
          </div>
        </section>
        )}

        {!hiddenPanels.has("profile") && (
        <section className="profile-panel resizable-panel">
          {panelHeading("profile", <ListTree size={18} />)}
          <div className="profile-form">
            <FieldLabel
              className="wide"
              title="Build mode"
              help="Choose whether this run should export from Godot first or skip Godot and upload files that already exist at each depot source path."
            >
              <div className="segmented-control" role="group" aria-label="Build mode">
                <button
                  type="button"
                  className={usesGodotExport ? "selected" : ""}
                  onClick={() => setProfileDraft({ ...profileDraft, buildMode: "godot_export" })}
                >
                  Export with Godot
                </button>
                <button
                  type="button"
                  className={!usesGodotExport ? "selected" : ""}
                  onClick={() => setProfileDraft({ ...profileDraft, buildMode: "existing_folder" })}
                >
                  Use existing folder
                </button>
              </div>
            </FieldLabel>
            <FieldLabel title="Game name" help="Your local display name for this game profile. It does not need to match the Steam store name.">
              <input
                aria-label="Game name"
                placeholder="My Game"
                value={profileDraft.name}
                onChange={(event) => setProfileDraft({ ...profileDraft, name: event.target.value })}
              />
            </FieldLabel>
            <FieldLabel title="Steam app ID" help="Numeric Steam app ID from Steamworks, not the depot ID.">
              <input
                aria-label="Steam app ID"
                placeholder="1234560"
                value={profileDraft.steamAppId}
                onChange={(event) => setProfileDraft({ ...profileDraft, steamAppId: event.target.value })}
              />
            </FieldLabel>
            <FieldLabel title="Beta branch to set live" help="Optional. Leave blank to upload the build without changing any live branch. Use a beta branch such as beta or internal when you want SetLive. Do not use default.">
              <input
                aria-label="Beta branch to set live"
                placeholder="optional, e.g. beta"
                value={profileDraft.testBranch}
                onChange={(event) => setProfileDraft({ ...profileDraft, testBranch: event.target.value })}
              />
            </FieldLabel>
            <FieldLabel
              className="wide"
              title="Godot project"
              help={usesGodotExport ? "Folder containing project.godot and export_presets.cfg. Click Presets after selecting it to populate preset suggestions." : "Optional in existing-folder mode. Relative depot source paths use the default export root first, then this folder if no export root is set."}
            >
              <div className="path-input">
                <input
                  aria-label="Godot project"
                  placeholder="C:\\Projects\\MyGame"
                  value={profileDraft.godotProjectPath}
                  onChange={(event) => setProfileDraft({ ...profileDraft, godotProjectPath: event.target.value })}
                />
                <button onClick={async () => {
                  const selected = await selectDirectory("Select Godot project folder");
                  if (selected) {
                    setProfileDraft({ ...profileDraft, godotProjectPath: selected });
                    await refreshPresets(selected);
                  }
                }}>
                  <FolderOpen size={16} />
                </button>
              </div>
            </FieldLabel>
            <FieldLabel
              className="wide"
              title="Build description"
              help="Steam build description. Supported tokens: {game}, {appId}, {branch}, {date}, {datetime}, {buildNotes}. If {buildNotes} is not used, build notes are appended automatically."
            >
              <input
                aria-label="Build description"
                placeholder="{game} {datetime}"
                value={profileDraft.buildDescriptionTemplate}
                onChange={(event) => setProfileDraft({ ...profileDraft, buildDescriptionTemplate: event.target.value })}
              />
            </FieldLabel>
          </div>

          <div className="depot-header">
            <h4>Depots</h4>
            <div>
              <button className="ghost-button" onClick={() => refreshPresets()}>
                <RefreshCcw size={15} />
                Presets
              </button>
              <button className="ghost-button" onClick={() => setProfileDraft({
                ...profileDraft,
                depots: [...profileDraft.depots, newDepotDraft(profileDraft.depots.length)]
              })}>
                <Plus size={15} />
                Depot
              </button>
            </div>
          </div>

          <datalist id="godot-presets">
            {presets.map((preset) => (
              <option key={preset.index} value={preset.name}>
                {preset.platform ?? ""}
              </option>
            ))}
          </datalist>

          <div className="depot-table" role="table">
            <div className="depot-row header" role="row">
              <span title="Local label only, used to make rows readable.">Platform</span>
              <span title="Short note used to distinguish this uploaded build target inside the generated build description.">Build note</span>
              <span title="Numeric depot ID from Steamworks.">Depot ID</span>
              <span title="Exact Godot export preset name from export_presets.cfg.">Preset</span>
              <span title={usesGodotExport ? "Godot export output path. Relative paths use the default export root." : "Existing build folder or file to upload. Relative paths use the default export root."}>
                {usesGodotExport ? "Output path" : "Source path"}
              </span>
              <span title="Destination path inside the Steam depot. Dot means depot root.">Steam path</span>
              <span title="Include the full exported folder recursively.">Recursive</span>
              <span></span>
            </div>
            {profileDraft.depots.map((depot, index) => (
              <div className="depot-row" role="row" key={depot.id ?? index}>
                <input aria-label={`Depot ${index + 1} platform label`} placeholder="Windows" value={depot.platformLabel} onChange={(event) => updateDepot(index, { platformLabel: event.target.value })} />
                <input aria-label={`Depot ${index + 1} build note`} placeholder="Steam release, x64, public demo..." value={depot.buildNote} onChange={(event) => updateDepot(index, { buildNote: event.target.value })} />
                <input aria-label={`Depot ${index + 1} depot ID`} placeholder="1234561" value={depot.depotId} onChange={(event) => updateDepot(index, { depotId: event.target.value })} />
                <input aria-label={`Depot ${index + 1} preset`} list="godot-presets" placeholder={usesGodotExport ? "Windows Desktop" : "Not used"} value={depot.exportPreset} disabled={!usesGodotExport} onChange={(event) => updateDepot(index, { exportPreset: event.target.value })} />
                <input aria-label={`Depot ${index + 1} output path`} placeholder={usesGodotExport ? "windows/game.exe" : "C:\\Builds\\MyGame\\windows"} value={depot.outputPath} onChange={(event) => updateDepot(index, { outputPath: event.target.value })} />
                <input aria-label={`Depot ${index + 1} Steam path`} placeholder="." value={depot.steamDepotPath} onChange={(event) => updateDepot(index, { steamDepotPath: event.target.value })} />
                <label className="toggle-cell">
                  <input
                    type="checkbox"
                    checked={depot.recursive}
                    onChange={(event) => updateDepot(index, { recursive: event.target.checked })}
                  />
                </label>
                <button className="icon-button danger" onClick={() => removeDepot(index)} disabled={profileDraft.depots.length === 1}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="depot-guide">
            <div><strong>Build note</strong><span>Optional note for this uploaded target. SteamPipe has one app-level build description, so these notes are combined into that description.</span></div>
            <div><strong>Preset</strong><span>{usesGodotExport ? 'Exact Godot export preset name, usually "Windows Desktop". Use the Presets button after choosing the Godot project.' : "Not used when uploading an existing folder."}</span></div>
            <div><strong>{usesGodotExport ? "Output path" : "Source path"}</strong><span>{usesGodotExport ? "Where Godot writes the exported executable or folder. Relative paths are placed under the default export root." : "Folder or exported executable that already exists. The app uploads the containing folder without running Godot."}</span></div>
            <div><strong>Steam path</strong><span>Where files land inside the depot. Use "." for the depot root unless you need a subfolder.</span></div>
            <div><strong>Recursive</strong><span>Keep enabled for normal Godot exports so the executable, PCK, DLLs, and subfolders are included.</span></div>
          </div>

          <div className="profile-actions">
            {selectedProfileId && (
              <button className="danger-button" onClick={() => deleteProfile(selectedProfileId)}>
                <Trash2 size={16} />
                Delete profile
              </button>
            )}
          </div>
        </section>
        )}

        {!hiddenPanels.has("runs") && (
        <section className="run-panel resizable-panel">
          {panelHeading("runs", <Clock size={18} />)}
          <div className="run-controls">
            {activeRun && (
              <button className="danger-button" onClick={() => window.steamUploader.cancelRun(activeRun.id)}>
                <Square size={15} />
                Cancel
              </button>
            )}
          </div>
          <div className="run-history">
            {selectedRuns.map((run) => (
              <button
                className={`run-card ${run.id === selectedRunId ? "selected" : ""} ${run.status}`}
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
              >
                <strong>{runLabel(run)}</strong>
                <span>{formatDate(run.startedAt)}</span>
                {run.error && <em>{run.error}</em>}
                {run.buildId && <span>Build {run.buildId}</span>}
              </button>
            ))}
          </div>
        </section>
        )}

        {!hiddenPanels.has("log") && (
        <section className="log-panel resizable-panel">
          {panelHeading("log", <Terminal size={18} />)}
          <div className="log-output" ref={logOutputRef}>
            {logs.length === 0 ? (
              <span className="empty-log">No log selected.</span>
            ) : (
              logs.map((log) => (
                <div className={`log-line ${log.source}`} key={log.id}>
                  <time>{new Date(log.timestamp).toLocaleTimeString()}</time>
                  <strong>{log.source}</strong>
                  <span>{log.line}</span>
                </div>
              ))
            )}
          </div>
        </section>
        )}
      </main>
    </div>
  );
}

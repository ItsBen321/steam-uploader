import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AppSnapshot, GameProfile } from "../src/shared/types";

const settings = {
  contentBuilderPath: "",
  steamCmdPath: "",
  godotPath: "",
  defaultExportRoot: "",
  steamAccount: "",
  updatedAt: null
};

function profile(overrides: Partial<GameProfile> = {}): GameProfile {
  return {
    id: "profile-1",
    name: "Clockwork Arena",
    buildMode: "godot_export",
    steamAppId: "123456",
    godotProjectPath: "C:\\Game",
    testBranch: "beta",
    buildDescriptionTemplate: "{game} {datetime}",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    depots: [],
    ...overrides
  };
}

function installApi(snapshot: AppSnapshot) {
  const api = {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    saveSettings: vi.fn().mockResolvedValue(snapshot),
    saveProfile: vi.fn().mockImplementation(async (input) => profile({ ...input, id: input.id ?? "saved-profile" })),
    deleteProfile: vi.fn().mockResolvedValue(snapshot),
    getExportPresets: vi.fn().mockResolvedValue([]),
    startRelease: vi.fn().mockResolvedValue({
      id: "run-2",
      profileId: "profile-1",
      status: "queued",
      stage: "queued",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: null,
      previewScriptPath: null,
      uploadScriptPath: null,
      buildId: null,
      manifestIds: [],
      error: null
    }),
    confirmUpload: vi.fn(),
    cancelRun: vi.fn(),
    getRunLogs: vi.fn().mockResolvedValue([]),
    selectPath: vi.fn().mockResolvedValue(null),
    openSteamCmdLoginShell: vi.fn().mockResolvedValue({ ok: true, snapshot }),
    openPanelWindow: vi.fn().mockResolvedValue(true),
    dockPanelWindow: vi.fn().mockResolvedValue(true),
    onPanelDocked: vi.fn().mockReturnValue(() => undefined),
    onPipelineEvent: vi.fn().mockReturnValue(() => undefined)
  };

  Object.defineProperty(window, "steamUploader", {
    value: api,
    configurable: true
  });

  return api;
}

describe("App renderer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("creates a profile draft and saves it through IPC", async () => {
    const api = installApi({ settings, profiles: [], runs: [] });
    render(<App />);

    fireEvent.change(await screen.findByLabelText("Game name"), { target: { value: "New Game" } });
    fireEvent.change(screen.getByLabelText("Steam app ID"), { target: { value: "555555" } });
    fireEvent.click(screen.getByText("Save profile"));

    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "New Game",
        steamAppId: "555555"
      })
    );
  });

  it("shows run history and failed run errors", async () => {
    installApi({
      settings,
      profiles: [profile()],
      runs: [
        {
          id: "run-1",
          profileId: "profile-1",
          status: "failed",
          stage: "failed",
          startedAt: "2026-05-03T10:00:00.000Z",
          finishedAt: "2026-05-03T10:01:00.000Z",
          previewScriptPath: null,
          uploadScriptPath: null,
          buildId: null,
          manifestIds: [],
          error: "Steam login failed."
        }
      ]
    });

    render(<App />);
    expect(await screen.findByText("Steam login failed.")).toBeInTheDocument();
  });

  it("clears the selected profile when starting a new game", async () => {
    installApi({ settings, profiles: [profile()], runs: [] });
    render(<App />);

    expect(await screen.findByDisplayValue("Clockwork Arena")).toBeInTheDocument();
    fireEvent.click(screen.getByText("New game"));

    await waitFor(() => expect(screen.getByLabelText("Game name")).toHaveValue(""));
    expect(screen.queryByText("Delete profile")).not.toBeInTheDocument();
  });

  it("keeps a saved profile selected and allows deleting it", async () => {
    const api = installApi({ settings, profiles: [], runs: [] });
    render(<App />);

    fireEvent.change(await screen.findByLabelText("Game name"), { target: { value: "Saved Game" } });
    fireEvent.change(screen.getByLabelText("Steam app ID"), { target: { value: "777777" } });
    fireEvent.click(screen.getByText("Save profile"));

    await waitFor(() => expect(screen.getByText("Delete profile")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Delete profile"));

    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("saved-profile"));
  });

  it("passes unsaved settings to the SteamCMD login shell action", async () => {
    const api = installApi({ settings, profiles: [], runs: [] });
    render(<App />);

    fireEvent.change(await screen.findByLabelText("ContentBuilder path"), {
      target: { value: "C:\\SteamworksSDK\\tools\\ContentBuilder" }
    });
    fireEvent.change(screen.getByLabelText("Steam account"), { target: { value: "builder_account" } });
    fireEvent.click(screen.getByTitle("Save these settings and open SteamCMD login"));

    await waitFor(() => expect(api.openSteamCmdLoginShell).toHaveBeenCalled());
    expect(api.openSteamCmdLoginShell).toHaveBeenCalledWith(
      expect.objectContaining({
        contentBuilderPath: "C:\\SteamworksSDK\\tools\\ContentBuilder",
        steamAccount: "builder_account"
      })
    );
  });

  it("can hide and restore a panel", async () => {
    installApi({ settings, profiles: [], runs: [] });
    render(<App />);

    fireEvent.click(await screen.findAllByTitle("Hide this panel").then((buttons) => buttons[0]));
    expect(screen.queryByText("ContentBuilder path")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Setup"));
    expect(await screen.findByText("ContentBuilder path")).toBeInTheDocument();
  });

  it("can request a panel popout", async () => {
    const api = installApi({ settings, profiles: [profile()], runs: [] });
    render(<App />);

    fireEvent.click(await screen.findAllByTitle("Open this panel in a separate window").then((buttons) => buttons[0]));
    await waitFor(() => expect(api.openPanelWindow).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: "setup" })
    ));
  });
});

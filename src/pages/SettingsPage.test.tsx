import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Backend = Record<string, unknown>;

/**
 * Routes invoke() by command name. A function value is called with the
 * command args; throwing from it rejects the invoke like a Rust Err would.
 */
function mockBackend(overrides: Backend = {}): Backend {
  const backend: Backend = {
    get_addon_path: "C:/AddOns",
    get_sync_interval: 2,
    get_staleness_warning_days: 180,
    get_staleness_error_days: 365,
    get_hide_staleness_warnings: false,
    get_autostart_status: "disabled",
    get_start_minimized_on_autostart: true,
    ...overrides,
  };
  mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    const value = backend[cmd];
    if (typeof value === "function") {
      try {
        return Promise.resolve(value(args));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return Promise.resolve(value);
  });
  return backend;
}

async function renderSettings() {
  render(<SettingsPage />);
  // All mocked getters resolve together; wait for one to know they have.
  await screen.findByText("Path detected");
  return {
    autostart: screen.getByLabelText("Launch Grimoire when I sign in"),
    minimized: screen.getByLabelText("Start minimized to the system tray"),
  };
}

function callsTo(cmd: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === cmd);
}

describe("SettingsPage startup", () => {
  it("shows launch at login off when the OS has no entry", async () => {
    mockBackend();
    const { autostart, minimized } = await renderSettings();

    expect(autostart).not.toBeChecked();
    expect(minimized).toBeDisabled();
    expect(screen.queryByText(/Turned off in your system's startup settings/)).toBeNull();
  });

  it("shows launch at login on and the minimized preference when enabled", async () => {
    mockBackend({ get_autostart_status: "enabled", get_start_minimized_on_autostart: false });
    const { autostart, minimized } = await renderSettings();

    await waitFor(() => expect(autostart).toBeChecked());
    expect(minimized).toBeEnabled();
    expect(minimized).not.toBeChecked();
  });

  it("explains when the system has disabled the entry", async () => {
    mockBackend({ get_autostart_status: "disabled_by_system" });
    const { autostart, minimized } = await renderSettings();

    expect(
      await screen.findByText(/Turned off in your system's startup settings/)
    ).toBeInTheDocument();
    expect(autostart).not.toBeChecked();
    expect(minimized).toBeDisabled();
  });

  it("enables launch at login and re-reads the OS status", async () => {
    const backend: Backend = mockBackend({
      set_autostart_enabled: ({ enabled }: { enabled: boolean }) => {
        backend.get_autostart_status = enabled ? "enabled" : "disabled";
      },
    });
    const { autostart, minimized } = await renderSettings();

    fireEvent.click(autostart);

    await waitFor(() => expect(callsTo("get_autostart_status")).toHaveLength(2));
    expect(mockInvoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: true });
    await waitFor(() => expect(autostart).toBeChecked());
    expect(minimized).toBeEnabled();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("disables launch at login", async () => {
    const backend: Backend = mockBackend({
      get_autostart_status: "enabled",
      set_autostart_enabled: ({ enabled }: { enabled: boolean }) => {
        backend.get_autostart_status = enabled ? "enabled" : "disabled";
      },
    });
    const { autostart, minimized } = await renderSettings();
    await waitFor(() => expect(autostart).toBeChecked());

    fireEvent.click(autostart);

    await waitFor(() => expect(callsTo("get_autostart_status")).toHaveLength(2));
    expect(mockInvoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: false });
    expect(autostart).not.toBeChecked();
    expect(minimized).toBeDisabled();
  });

  it("reverts the checkbox and shows the error when enabling fails", async () => {
    mockBackend({
      set_autostart_enabled: () => {
        throw "Failed to access registry key: access denied";
      },
    });
    const { autostart } = await renderSettings();

    fireEvent.click(autostart);

    expect(
      await screen.findByText("Error: Failed to access registry key: access denied")
    ).toBeInTheDocument();
    expect(autostart).not.toBeChecked();
    expect(autostart).toBeEnabled();
    expect(callsTo("get_autostart_status")).toHaveLength(1);
  });

  it("saves the start minimized preference", async () => {
    mockBackend({ get_autostart_status: "enabled" });
    const { autostart, minimized } = await renderSettings();
    await waitFor(() => expect(autostart).toBeChecked());
    expect(minimized).toBeChecked();

    fireEvent.click(minimized);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_start_minimized_on_autostart", {
        minimized: false,
      })
    );
    expect(minimized).not.toBeChecked();
    expect(callsTo("set_autostart_enabled")).toHaveLength(0);
  });
});

/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SyncIntervalSection } from "./SyncIntervalSection";
import * as authSession from "../../../../auth/authSession";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import {
  MAX_SYNC_INTERVAL_MS,
  MIN_SYNC_INTERVAL_MS,
  readSyncIntervalMs,
} from "../../../../data/workspace/syncSettings";
import { __resetWorkspaceSyncStateForTests } from "../../../../data/workspace/workspaceSync";
import type { AuthSession } from "../../../../auth/authTypes";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";

const mocks = vi.hoisted(() => ({
  directoryHandle: null as unknown,
  canMutate: true,
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: mocks.directoryHandle, status: "ready" }),
}));

vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    canMutate: (featureId: string) =>
      featureId === "settings.syncInterval" ? mocks.canMutate : false,
  }),
}));

function session(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    role: "admin",
    username: "admin",
    loginAt: new Date().toISOString(),
    ...overrides,
  };
}

function asAdmin(): void {
  vi.spyOn(authSession, "readRealSession").mockReturnValue(session());
}

function newWorkspace(name = "sync-settings-ws"): DirectoryHandleLike {
  const root = createMemoryDirectory(name) as unknown as DirectoryHandleLike;
  mocks.directoryHandle = root;
  return root;
}

/** Open the collapsed card so its body is in the DOM. */
function openSection(): void {
  fireEvent.click(screen.getByText(DEFAULT_LABELS.settings_sync_title));
}

const seconds = (ms: number) => String(ms / 1000);

beforeEach(() => {
  vi.restoreAllMocks();
  __resetWorkspaceSyncStateForTests();
  mocks.directoryHandle = null;
  mocks.canMutate = true;
});

afterEach(() => {
  cleanup();
  __resetWorkspaceSyncStateForTests();
});

describe("SyncIntervalSection — who may see it", () => {
  it("renders for a real signed-in admin", () => {
    asAdmin();
    render(<SyncIntervalSection />);
    expect(screen.getByText(DEFAULT_LABELS.settings_sync_title)).toBeInTheDocument();
  });

  it("renders nothing at all for a non-admin role", () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(
      session({ role: "manager", username: "amonem" })
    );
    const { container } = render(<SyncIntervalSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for an admin inside a read-only demo session", () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(session({ mode: "demo" }));
    const { container } = render(<SyncIntervalSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no session at all", () => {
    vi.spyOn(authSession, "readRealSession").mockReturnValue(null);
    const { container } = render(<SyncIntervalSection />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SyncIntervalSection — the canMutate capability", () => {
  it("is read-only (input and save disabled) when canMutate denies the feature", () => {
    asAdmin();
    newWorkspace();
    mocks.canMutate = false;

    render(<SyncIntervalSection />);
    openSection();

    expect(screen.getByRole("spinbutton")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: DEFAULT_LABELS.settings_sync_save })
    ).toBeDisabled();
  });

  it("blocks the write at the HANDLER boundary too, even if a stale render left the button enabled", async () => {
    asAdmin();
    const root = newWorkspace();

    render(<SyncIntervalSection />);
    openSection();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "60" } });

    // Capability revoked between render and click.
    mocks.canMutate = false;
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.settings_sync_save }));

    await screen.findByText(DEFAULT_LABELS.settings_sync_no_permission);
    // Nothing reached disk.
    await expect(readSyncIntervalMs(root)).resolves.toBe(45_000);
  });
});

describe("SyncIntervalSection — validation and saving", () => {
  it("shows the current effective value read from the workspace", async () => {
    asAdmin();
    const root = newWorkspace();
    const { saveSyncIntervalMs } = await import("../../../../data/workspace/syncSettings");
    await saveSyncIntervalMs(root, 120_000, "someone-else");

    render(<SyncIntervalSection />);
    openSection();

    await waitFor(() => {
      expect(
        screen.getByText(DEFAULT_LABELS.settings_sync_current.replace("{seconds}", "120"))
      ).toBeInTheDocument();
    });
  });

  it("rejects a value below the floor with an Arabic error and writes nothing", async () => {
    asAdmin();
    const root = newWorkspace();

    render(<SyncIntervalSection />);
    openSection();
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: seconds(MIN_SYNC_INTERVAL_MS - 1000) },
    });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.settings_sync_save }));

    expect(await screen.findByRole("alert")).toHaveTextContent("قيمة غير صالحة");
    await expect(readSyncIntervalMs(root)).resolves.toBe(45_000);
  });

  it("rejects a value above the ceiling, a non-integer and an empty field", async () => {
    asAdmin();
    const root = newWorkspace();

    render(<SyncIntervalSection />);
    openSection();
    const input = screen.getByRole("spinbutton");
    const save = screen.getByRole("button", { name: DEFAULT_LABELS.settings_sync_save });

    for (const bad of [seconds(MAX_SYNC_INTERVAL_MS + 1000), "20.5", ""]) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(save);
      expect(await screen.findByRole("alert")).toHaveTextContent("قيمة غير صالحة");
    }
    await expect(readSyncIntervalMs(root)).resolves.toBe(45_000);
  });

  it("saves a valid value to the workspace and confirms it", async () => {
    asAdmin();
    const root = newWorkspace();

    render(<SyncIntervalSection />);
    openSection();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.settings_sync_save }));

    await screen.findByText(DEFAULT_LABELS.settings_sync_saved);
    await expect(readSyncIntervalMs(root)).resolves.toBe(90_000);
  });

  it("surfaces a save failure instead of claiming success", async () => {
    asAdmin();
    mocks.directoryHandle = createMemoryDirectory("denied-ws", {
      initialWritePermission: "denied",
      writePermissionRequestOutcome: "denied",
    }) as unknown as DirectoryHandleLike;

    render(<SyncIntervalSection />);
    openSection();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.settings_sync_save }));

    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_LABELS.settings_sync_saved)).not.toBeInTheDocument();
  });

  it("says so plainly when there is no workspace to save into", async () => {
    asAdmin();
    mocks.directoryHandle = null;

    render(<SyncIntervalSection />);
    openSection();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.settings_sync_save }));

    await screen.findByText(DEFAULT_LABELS.settings_sync_no_workspace);
  });
});

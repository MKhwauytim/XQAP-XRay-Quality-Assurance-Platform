/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StorageSection } from "./StorageSection";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { clearErrors, getRecentErrors } from "../../../../data/storage/errorLogger";
import * as storageRegistry from "../../../../data/storage/storageRegistry";

// StorageSection's reset button is gated by canMutate("view-error-log")
// (Finding 3: the reset is destructive and the Settings tab allows the
// guest role, so it must not be reachable ungated). Mocked the same way
// ErrorLogSection.test.tsx mocks it, to avoid needing a WorkspaceContext
// provider just to exercise usePermissions' workspaceReady check.
const permissionsMock = vi.hoisted(() => ({ canMutate: true }));
vi.mock("../../../../auth/usePermissions", () => ({
  usePermissions: () => ({
    canMutate: (featureId: string) =>
      featureId === "view-error-log" ? permissionsMock.canMutate : false,
  }),
}));

// File-wide default so every describe block below (which each define their
// own navigator.storage/indexedDB setup) doesn't also have to remember to
// reset this.
beforeEach(() => {
  permissionsMock.canMutate = true;
});

describe("StorageSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    Object.defineProperty(navigator, "storage", {
      value: {
        estimate: async () => ({ usage: 5_000_000, quota: 100_000_000 }),
        persisted: async () => true,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: {
        databases: async () => [
          { name: "xray-quality-app-persistence" },
          { name: "kanban-fs" },
        ],
      },
      configurable: true,
    });
  });

  it("lists the storage this app owns", async () => {
    render(<StorageSection />);
    expect(await screen.findByText(DEFAULT_LABELS.storage_owned_keys_title)).toBeInTheDocument();
    expect(await screen.findByText(/xray_auth_session_v1/)).toBeInTheDocument();
  });

  it("lists foreign databases as belonging to other applications", async () => {
    render(<StorageSection />);
    expect(await screen.findByText(/kanban-fs/)).toBeInTheDocument();
    expect(
      await screen.findByText(DEFAULT_LABELS.storage_foreign_dbs_note)
    ).toBeInTheDocument();
  });

  it("does not offer to delete foreign databases", async () => {
    render(<StorageSection />);
    const foreign = await screen.findByText(/kanban-fs/);
    const row = foreign.closest("li");
    expect(row?.querySelector("button")).toBeNull();
  });

  it("clears nothing when the confirmation is declined", async () => {
    localStorage.setItem("xray_auth_session_v1", "session-token");

    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();

    // UIX-02: the app's own RTL ConfirmDialog, not native window.confirm.
    expect(
      await screen.findByText(DEFAULT_LABELS.storage_reset_confirm)
    ).toBeInTheDocument();
    (
      await screen.findByRole("button", {
        name: DEFAULT_LABELS.confirm_dialog_default_cancel,
      })
    ).click();

    // Declined: the key must survive.
    expect(localStorage.getItem("xray_auth_session_v1")).toBe("session-token");
  });

  it("clears owned keys but not foreign ones when confirmed", async () => {
    localStorage.setItem("xray_auth_session_v1", "session-token");
    localStorage.setItem("kanban-fs-state", "foreign");
    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();
    (
      await screen.findByRole("button", {
        name: DEFAULT_LABELS.confirm_dialog_default_ok,
      })
    ).click();
    await vi.waitFor(() => {
      expect(localStorage.getItem("xray_auth_session_v1")).toBeNull();
    });

    expect(localStorage.getItem("kanban-fs-state")).toBe("foreign");
  });
});

describe("StorageSection - storage APIs unavailable", () => {
  // A distinct top-level describe so the outer suite's beforeEach (which
  // always defines navigator.storage and indexedDB) never runs for these
  // tests. Saved descriptors are restored afterward so this block can never
  // leak an "undefined" navigator.storage/indexedDB into sibling test files
  // sharing the same jsdom worker.
  const originalNavigatorStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

  afterEach(() => {
    cleanup();
    if (originalNavigatorStorage) {
      Object.defineProperty(navigator, "storage", originalNavigatorStorage);
    }
    if (originalIndexedDb) {
      Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    }
  });

  it("renders without throwing when navigator.storage and indexedDB are both undefined", async () => {
    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });

    render(<StorageSection />);

    // The owned-keys section (which needs neither API) must still render --
    // this is the "global constraint" this task named explicitly: the panel
    // must not throw when estimate()/databases() are absent.
    expect(await screen.findByText(DEFAULT_LABELS.storage_owned_keys_title)).toBeInTheDocument();
    expect(await screen.findByText(/xray_auth_session_v1/)).toBeInTheDocument();
    // No quota figure can be shown without navigator.storage.estimate().
    expect(screen.queryByText(new RegExp(DEFAULT_LABELS.storage_quota_label))).toBeNull();
    // No foreign databases can be discovered without indexedDB.databases().
    expect(screen.queryByText(DEFAULT_LABELS.storage_foreign_dbs_title)).toBeNull();
  });
});

describe("StorageSection - reset failure is observable, not swallowed", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "storage", {
      value: {
        estimate: async () => ({ usage: 5_000_000, quota: 100_000_000 }),
        persisted: async () => true,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: { databases: async () => [] },
      configurable: true,
    });
    clearErrors();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearErrors();
  });

  it("logs to the error ring buffer and shows a visible message when clearOwnedStorage rejects", async () => {
    const boom = new Error("indexedDB.deleteDatabase blocked");
    vi.spyOn(storageRegistry, "clearOwnedStorage").mockRejectedValueOnce(boom);
    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();
    (
      await screen.findByRole("button", {
        name: DEFAULT_LABELS.confirm_dialog_default_ok,
      })
    ).click();

    // Finding 2: the failure must be diagnosable via the existing error log,
    // not a fully silent catch.
    await vi.waitFor(() => {
      expect(getRecentErrors().some((e) => e.message === boom.message)).toBe(true);
    });
    // ...and visible to the user, since storage_reset_confirm promises the
    // workspace-folder link will be cleared -- a partial failure must not
    // look identical to success.
    expect(
      await screen.findByText(DEFAULT_LABELS.storage_reset_partial_failure)
    ).toBeInTheDocument();
  });
});

describe("StorageSection - Finding 3: reset is capability-gated", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "storage", {
      value: {
        estimate: async () => ({ usage: 5_000_000, quota: 100_000_000 }),
        persisted: async () => true,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: { databases: async () => [] },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("disables the reset button when the role lacks the capability", async () => {
    permissionsMock.canMutate = false;

    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });

    expect(button).toBeDisabled();
  });

  it("never prompts for confirmation or clears storage when clicked without the capability (handler boundary)", async () => {
    permissionsMock.canMutate = false;
    localStorage.setItem("xray_auth_session_v1", "session-token");
    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    // A disabled button's onClick is unreachable via a real user click in a
    // browser, but jsdom still allows firing it programmatically -- assert
    // the handler itself refuses, not just that the button is visually off.
    button.click();

    // The confirmation must not even open without the capability.
    expect(
      screen.queryByText(DEFAULT_LABELS.storage_reset_confirm)
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("xray_auth_session_v1")).toBe("session-token");
  });

  it("enables the reset button and allows reset when the role has the capability", async () => {
    permissionsMock.canMutate = true;
    localStorage.setItem("xray_auth_session_v1", "session-token");
    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    expect(button).not.toBeDisabled();

    button.click();
    (
      await screen.findByRole("button", {
        name: DEFAULT_LABELS.confirm_dialog_default_ok,
      })
    ).click();
    await vi.waitFor(() => {
      expect(localStorage.getItem("xray_auth_session_v1")).toBeNull();
    });
  });
});

describe("StorageSection - Finding 2: persistence state reflects a reload, not just this tab's runtime state", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows persistent when navigator.storage.persisted() resolves true, even though getPersistenceState() is still 'unknown' on a fresh reload", async () => {
    // Simulates the normal case: a page reload restores the workspace via
    // saveLastWorkspace's own reconnect path, which never calls
    // requestStoragePersistence() again -- so the in-tab runtime state
    // (getPersistenceState()) is "unknown", exactly as it is at import time
    // in this test file. Only the direct browser probe can tell the truth.
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => true },
      configurable: true,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: { databases: async () => [] },
      configurable: true,
    });
    expect(storageRegistry.getPersistenceState()).toBe("unknown");

    render(<StorageSection />);

    expect(
      await screen.findByText(DEFAULT_LABELS.storage_persistence_granted)
    ).toBeInTheDocument();
  });

  it("shows non-persistent when the probe resolves false", async () => {
    Object.defineProperty(navigator, "storage", {
      value: { persisted: async () => false },
      configurable: true,
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: { databases: async () => [] },
      configurable: true,
    });

    render(<StorageSection />);

    expect(
      await screen.findByText(DEFAULT_LABELS.storage_persistence_denied)
    ).toBeInTheDocument();
  });

  it("falls back to getPersistenceState() when the probe itself is unavailable", async () => {
    Object.defineProperty(navigator, "storage", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
    expect(storageRegistry.getPersistenceState()).toBe("unknown");

    render(<StorageSection />);

    // No persisted() to call -> falls back to the runtime state ("unknown"),
    // which renders as the same copy as "denied".
    expect(
      await screen.findByText(DEFAULT_LABELS.storage_persistence_denied)
    ).toBeInTheDocument();
  });
});

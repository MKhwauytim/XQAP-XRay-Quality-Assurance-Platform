/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StorageSection } from "./StorageSection";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { clearErrors, getRecentErrors } from "../../../../data/storage/errorLogger";
import * as storageRegistry from "../../../../data/storage/storageRegistry";

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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();

    expect(confirmSpy).toHaveBeenCalledWith(DEFAULT_LABELS.storage_reset_confirm);
    // Declined: the key must survive.
    expect(localStorage.getItem("xray_auth_session_v1")).toBe("session-token");
    confirmSpy.mockRestore();
  });

  it("clears owned keys but not foreign ones when confirmed", async () => {
    localStorage.setItem("xray_auth_session_v1", "session-token");
    localStorage.setItem("kanban-fs-state", "foreign");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();
    await vi.waitFor(() => {
      expect(localStorage.getItem("xray_auth_session_v1")).toBeNull();
    });

    expect(localStorage.getItem("kanban-fs-state")).toBe("foreign");
    confirmSpy.mockRestore();
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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<StorageSection />);
    const button = await screen.findByRole("button", {
      name: DEFAULT_LABELS.storage_reset_button,
    });
    button.click();

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

    confirmSpy.mockRestore();
  });
});

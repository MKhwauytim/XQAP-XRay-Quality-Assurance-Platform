/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StorageSection } from "./StorageSection";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";

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

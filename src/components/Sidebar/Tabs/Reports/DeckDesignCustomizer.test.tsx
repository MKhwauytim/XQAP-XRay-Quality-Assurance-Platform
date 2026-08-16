/* @vitest-environment jsdom */
// Cluster A: DeckDesignCustomizer's "حفظ" (save) button previously rendered enabled
// regardless of canMutate("export-reports") -- only `handleSave` re-checked it, so the
// control looked usable and only rejected on click (with no visible affordance change).
// This mirrors the established render+handler pattern used by Reports/TabView.tsx's own
// export controls, just applied to this dialog's Save button too.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import DeckDesignCustomizer from "./DeckDesignCustomizer";

vi.mock("../../../../auth/authSession", () => ({
  readSession: () => ({ username: "admin", role: "admin" }),
}));

afterEach(() => cleanup());

describe("DeckDesignCustomizer — render-time canMutate gate on Save (cluster A)", () => {
  it("disables the Save button when canMutate('export-reports') is false", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    render(
      <DeckDesignCustomizer
        loadExecInput={async () => null}
        buildDisplayNameMap={() => ({})}
        directoryHandle={root}
        canMutate={() => false}
        onClose={() => {}}
      />
    );

    const saveButton = await screen.findByRole("button", { name: "حفظ" });
    await waitFor(() => expect(saveButton).toBeDisabled());
  });

  it("enables the Save button and saves when canMutate('export-reports') is true", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;

    render(
      <DeckDesignCustomizer
        loadExecInput={async () => null}
        buildDisplayNameMap={() => ({})}
        directoryHandle={root}
        canMutate={() => true}
        onClose={() => {}}
      />
    );

    const saveButton = await screen.findByRole("button", { name: "حفظ" });
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("تم حفظ تخصيص التصميم.")).toBeInTheDocument();
    });
  });
});

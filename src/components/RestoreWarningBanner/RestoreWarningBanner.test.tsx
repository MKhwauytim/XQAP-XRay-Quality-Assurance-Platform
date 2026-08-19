/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { RestoreWarningBanner } from "./RestoreWarningBanner";
import { RESTORE_INPROGRESS_FILE } from "../../data/backup/restoreSentinel";
import { createMemoryDirectory } from "../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../data/storage/fileSystemAccess";
import { safeWriteJson } from "../../data/storage/safeWrite";
import { getSystemRoot } from "../../data/workspace/workspacePaths";

afterEach(cleanup);

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("banner-root") as DirectoryHandleLike;
}

async function writeSentinel(root: DirectoryHandleLike, startedAt: string): Promise<void> {
  const systemDir = await getSystemRoot(root, true);
  await safeWriteJson(systemDir, RESTORE_INPROGRESS_FILE, {
    startedAt,
    startedBy: "admin",
  });
}

/** Lets the banner's read-once effect settle before asserting an ABSENCE. */
async function settle(): Promise<void> {
  await waitFor(() => {
    expect(document.body).toBeTruthy();
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RestoreWarningBanner", () => {
  it("warns when a stale restore sentinel is present", async () => {
    const root = makeRoot();
    await writeSentinel(root, new Date(Date.now() - 60 * 60 * 1000).toISOString());

    render(<RestoreWarningBanner directoryHandle={root} />);

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("admin");
    expect(banner.textContent).toContain("الاستعادة");
  });

  it("renders nothing when there is no sentinel", async () => {
    const root = makeRoot();
    render(<RestoreWarningBanner directoryHandle={root} />);
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing while a restore started moments ago is still plausibly running", async () => {
    const root = makeRoot();
    await writeSentinel(root, new Date().toISOString());

    render(<RestoreWarningBanner directoryHandle={root} />);
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing without a workspace", async () => {
    render(<RestoreWarningBanner directoryHandle={null} />);
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

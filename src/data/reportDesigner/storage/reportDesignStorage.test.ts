import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { createEmptyDocument, type Page } from "../reportTypes";
import {
  saveDesign,
  loadDesign,
  loadDesignIndex,
  deleteDesign,
} from "./reportDesignStorage";

describe("reportDesignStorage", () => {
  it("round-trips a design and updates the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تقرير الأداء", "admin");
    const saved = await saveDesign(dir, doc);
    expect(saved.ok).toBe(true);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded?.reportName).toBe("تقرير الأداء");

    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).toContain(doc.reportId);
  });

  it("deletes a design and removes it from the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("للحذف", "admin");
    await saveDesign(dir, doc);
    const del = await deleteDesign(dir, doc.reportId);
    expect(del.ok).toBe(true);
    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).not.toContain(doc.reportId);
  });

  it("preserves both index entries on concurrent saves (cross-machine CAS)", async () => {
    const dir = createMemoryDirectory("root");
    // Two authors on two PCs save different designs at the same instant. The
    // withResourceLock + casLoop index RMW must land BOTH index entries.
    const docA = createEmptyDocument("تصميم أ", "admin");
    const docB = createEmptyDocument("تصميم ب", "admin");
    await Promise.all([saveDesign(dir, docA), saveDesign(dir, docB)]);

    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId).sort()).toEqual(
      [docA.reportId, docB.reportId].sort()
    );
    // Both writes participated in the CAS protocol → revision advanced past both.
    expect(index.revision).toBe(2);
  });

  it("serializes concurrent saves of the SAME report id via per-id CAS (no silent clobber)", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تصميم مشترك", "admin");
    // Two supervisors on two PCs edit the SAME design at the same instant.
    const docA = { ...doc, pages: [] };
    const extraPage: Page = { pageId: "p1", name: "صفحة 2", order: 1, filters: [], elements: [] };
    const docB = { ...doc, pages: [extraPage] };
    await Promise.all([saveDesign(dir, docA), saveDesign(dir, docB)]);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded).not.toBeNull();
    expect(loaded?.revision).toBe(2); // both writes participated in the CAS chain

    // The real no-clobber proof: without the fix, saveDesignFile throws on
    // every save (see reportDesignStorage.ts), which short-circuits the index
    // update inside the same withResourceLock callback — so this assertion is
    // what actually fails under the bug, not the revision check above.
    const index = await loadDesignIndex(dir);
    expect(index.designs).toHaveLength(1); // one entry, not duplicated
  });

  // Delayed-verify regression coverage (M-3 follow-up: saveDesignFile was the
  // one per-id casLoop site the M-3 audit didn't reach — see EDIT_LOG v55.2).
  //
  // casLoop's delayed-verify mechanism itself (sleep, re-read, retry-on-false)
  // is already exercised in isolation by `src/data/storage/casLoop.test.ts`.
  // Re-running that adversarial-timing scenario here would duplicate that
  // coverage. What isn't covered elsewhere is whether saveDesignFile's attempt
  // function actually WIRES UP the `verify` callback (as opposed to it being
  // absent) and still completes correctly in the normal, non-conflicting case.
  // This test checks exactly that: the delayed-verify path is provably
  // exercised (the call takes at least as long as casLoop's post-success
  // settle delay, which only happens when a `verify` callback was supplied —
  // see VERIFY_MIN_DELAY_MS/VERIFY_MAX_DELAY_MS in casLoop.ts) and the design
  // still saves correctly.
  it("saveDesign's delayed verify is actually wired in and a normal (non-conflicting) save still succeeds", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تصميم للتحقق المؤجل", "admin");

    const start = Date.now();
    const saved = await saveDesign(dir, doc);
    const elapsedMs = Date.now() - start;

    expect(saved.ok).toBe(true);
    // casLoop sleeps VERIFY_MIN_DELAY_MS..VERIFY_MAX_DELAY_MS (80-180ms).
    // Without a `verify` callback, this call returns in a few ms. A
    // comfortable lower bound confirms the callback is really reached, not
    // just present in source.
    expect(elapsedMs).toBeGreaterThanOrEqual(60);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded?.reportName).toBe("تصميم للتحقق المؤجل");
  });
});

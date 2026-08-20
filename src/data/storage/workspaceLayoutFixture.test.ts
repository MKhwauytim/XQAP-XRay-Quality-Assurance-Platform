import { beforeEach, describe, expect, it } from "vitest";

import {
  createWorkspaceFixture,
  readFixtureFileText,
  type WorkspaceFixtureLayout,
} from "./workspaceLayoutFixture";
import { safeReadJson } from "./safeWrite";
import {
  __clearWorkspaceDirCacheForTests,
  getPopulationMonthDir,
  getPopulationRoot,
  getSystemRoot,
  getTemplatesRoot,
  getUserDataRoot,
} from "../workspace/workspacePaths";

/**
 * Baseline coverage for the three layouts a real workspace can be in. These
 * tests PIN today's `workspacePaths` behaviour — they describe the world, they
 * do not ask for it to change. Anything that later reads/copies/probes a
 * workspace can now be tested against a legacy or mixed tree instead of only
 * against the freshly-created numbered one.
 */
beforeEach(() => {
  // Directory handles are memoized per root handle AND the resolved root name
  // is remembered; a fixture from a previous test must never answer for this
  // one's.
  __clearWorkspaceDirCacheForTests();
});

const LAYOUTS: WorkspaceFixtureLayout[] = ["numbered", "legacy", "mixed"];

describe("workspace layout fixture — root resolution on every layout", () => {
  for (const layout of LAYOUTS) {
    it(`resolves the population/system/templates roots on a ${layout} workspace`, async () => {
      const fixture = await createWorkspaceFixture({ layout });

      const population = await getPopulationRoot(fixture.root, false);
      const system = await getSystemRoot(fixture.root, false);
      const templates = await getTemplatesRoot(fixture.root, false);

      expect(population.name).toBe(fixture.rootNames.population);
      expect(system.name).toBe(fixture.rootNames.system);
      expect(templates.name).toBe(fixture.rootNames.templates);
    });

    it(`reads the month manifest through workspacePaths on a ${layout} workspace`, async () => {
      const fixture = await createWorkspaceFixture({ layout });

      const monthDir = await getPopulationMonthDir(fixture.root, fixture.monthFolderName, false);
      const manifest = await safeReadJson<{ monthFolderName: string; status: string }>(
        monthDir,
        "month.manifest.json"
      );

      expect(manifest.ok).toBe(true);
      if (!manifest.ok) return;
      expect(manifest.value.monthFolderName).toBe(fixture.monthFolderName);
    });

    it(`keeps every seeded plain (non-envelope) file byte-exact on a ${layout} workspace`, async () => {
      const fixture = await createWorkspaceFixture({ layout });

      for (const [path, text] of Object.entries(fixture.plainFiles)) {
        expect(await readFixtureFileText(fixture.root, path)).toBe(text);
        // A plain legacy payload is NOT an envelope: nothing may assume
        // `metadata`/`data` on the copy path.
        const parsed: unknown = JSON.parse(text);
        expect(Object.prototype.hasOwnProperty.call(parsed, "metadata")).toBe(false);
      }
    });

    it(`resolves 3-user-data on a ${layout} workspace (no legacy alias exists)`, async () => {
      const fixture = await createWorkspaceFixture({ layout });

      const userDataDir = await getUserDataRoot(fixture.root, false);
      expect(userDataDir.name).toBe("3-user-data");
      const users = await safeReadJson<{ metadata: { revision: number } }>(
        userDataDir,
        "users.permissions.json"
      );
      expect(users.ok).toBe(true);
    });
  }
});

describe("workspace layout fixture — legacy specifics", () => {
  it("keeps the large plain risk file multi-slice sized and readable as raw text", async () => {
    const fixture = await createWorkspaceFixture({ layout: "legacy" });

    const text = await readFixtureFileText(fixture.root, fixture.largePlainFilePath);
    expect(text.length).toBeGreaterThan(200 * 1024);
    expect(fixture.largePlainFilePath).toContain("Population/");
    expect(fixture.largePlainFilePath).toContain("/raw/");
  });

  it("does NOT create a numbered sibling root when a legacy root already exists", async () => {
    const fixture = await createWorkspaceFixture({ layout: "legacy" });

    // A create:true resolve is what an ordinary autosave does. It must adopt
    // the existing legacy root instead of creating `1-population/` next to it —
    // which would make every legacy month permanently invisible.
    const population = await getPopulationRoot(fixture.root, true);
    expect(population.name).toBe("Population");

    await expect(
      fixture.root.getDirectoryHandle("1-population", { create: false })
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("keeps the legacy flat sample master readable from the month folder", async () => {
    const fixture = await createWorkspaceFixture({ layout: "legacy" });

    const monthDir = await getPopulationMonthDir(fixture.root, fixture.monthFolderName, false);
    const sample = await safeReadJson<{ rows: unknown[] }>(monthDir, "sample.master.json");
    expect(sample.ok).toBe(true);
    if (!sample.ok) return;
    expect(sample.value.rows).toHaveLength(2);
  });
});

describe("workspace layout fixture — mixed layout", () => {
  it("prefers the numbered population root over the stray legacy one", async () => {
    const fixture = await createWorkspaceFixture({ layout: "mixed" });

    const population = await getPopulationRoot(fixture.root, false);
    expect(population.name).toBe("1-population");

    // Both roots exist on disk; the older month under the legacy folder is
    // simply unreachable through workspacePaths.
    await expect(
      fixture.root.getDirectoryHandle("Population", { create: false })
    ).resolves.toMatchObject({ name: "Population" });
    await expect(
      getPopulationMonthDir(fixture.root, "1-January-2026", false)
    ).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("still resolves the legacy system and templates roots alongside a numbered population root", async () => {
    const fixture = await createWorkspaceFixture({ layout: "mixed" });

    expect((await getSystemRoot(fixture.root, false)).name).toBe(".system");
    expect((await getTemplatesRoot(fixture.root, false)).name).toBe("templates");
  });
});

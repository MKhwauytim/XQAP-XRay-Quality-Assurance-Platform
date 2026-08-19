/**
 * Test-only workspace builder for the THREE layouts a field workspace can be
 * in — and only one of which the suite had ever exercised.
 *
 * `workspacePaths.ts` resolves every root numbered-first with a permanent
 * legacy fallback (`1-population/` → `Population/`, `5-system/` → `.system/`,
 * `6-templates/` → `templates/`), and there is NO migration: a workspace
 * created before the numbered layout stays unnumbered forever, and a workspace
 * that was half-touched by a newer client stays MIXED forever. Those are
 * exactly the big, old, busy workspaces the department depends on, and every
 * storage-level walk (backup, probe, archive) had been tested only against a
 * freshly-created numbered tree.
 *
 * This module builds the same realistic month content in whichever layout is
 * asked for, on top of `createMemoryDirectory`, so a test can assert that a
 * read/copy/probe path behaves identically on all three.
 *
 * ── Why some files are written as PLAIN text ──────────────────────────────
 * `safeWriteJson` wraps what it writes and (for the policy-listed names) may
 * compress it. A workspace old enough to be unnumbered also predates the
 * envelope: its `risk.raw.json` / `population.final.json` are bare JSON
 * payloads, often the largest files on the share. Those are seeded here with
 * their exact bytes through the raw handle — never through `safeWriteJson` —
 * because a copy path that quietly assumes "envelope" or "small enough to hold
 * as one JS string" fails on precisely those files, and a fixture built only
 * from `safeWriteJson` output could never show it.
 */
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { createMemoryDirectory } from "./memoryDirectory";
import { safeWriteJson } from "./safeWrite";
import { PLAIN_JSON_POLICY } from "./storagePolicy";

/**
 * `numbered` — everything under `1-population/`…`6-templates/`.
 * `legacy`   — the unnumbered roots (`Population/`, `.system/`, `templates/`)
 *              plus their unnumbered month children (`raw/`, `processed/`) and
 *              the flat, pre-`2-samples` sample file.
 * `mixed`    — a numbered population root alongside legacy `.system/` and
 *              `templates/`, AND a stray leftover `Population/` folder holding
 *              an older month. This is what a legacy workspace turns into the
 *              first time a newer client autosaves into it, and it is the only
 *              layout where two candidate population roots exist at once.
 */
export type WorkspaceFixtureLayout = "numbered" | "legacy" | "mixed";

export type WorkspaceFixtureOptions = {
  layout: WorkspaceFixtureLayout;
  /** Month folder name; defaults to `5-May-2026`. */
  monthFolderName?: string;
  /**
   * Approximate byte size of the seeded plain `risk.raw.json`. Defaults to a
   * few hundred KB — big enough to be multi-slice for a windowed copy, small
   * enough to keep the suite fast. Raise it in a test that needs a genuinely
   * large file.
   */
  plainRawFileBytes?: number;
};

export type WorkspaceFixture = {
  root: DirectoryHandleLike;
  layout: WorkspaceFixtureLayout;
  monthFolderName: string;
  /** On-disk folder names this layout actually used. */
  rootNames: {
    population: string;
    system: string;
    templates: string;
  };
  /**
   * Every PLAIN (non-envelope) file seeded, keyed by its "/"-joined path from
   * the workspace root, valued by its exact text. A copy/backup test compares
   * against these bytes.
   */
  plainFiles: Record<string, string>;
  /** Path of the large plain file, for convenience. */
  largePlainFilePath: string;
};

const DEFAULT_MONTH_FOLDER = "5-May-2026";
const DEFAULT_PLAIN_RAW_BYTES = 300 * 1024;

async function dir(
  parent: DirectoryHandleLike,
  ...names: string[]
): Promise<DirectoryHandleLike> {
  let current = parent;
  for (const name of names) {
    current = await current.getDirectoryHandle(name, { create: true });
  }
  return current;
}

/**
 * Writes `text` byte-for-byte, bypassing `safeWriteJson` entirely — no
 * envelope, no policy, no `.bak`/`.tmp` dance. That is the point: this is how
 * a pre-envelope file got onto the share in the first place.
 */
async function writePlainFile(
  parent: DirectoryHandleLike,
  fileName: string,
  text: string
): Promise<void> {
  const handle = await parent.getFileHandle(fileName, { create: true });
  // `createWritable` is optional on FileHandleLike (CLAUDE.md) — guard it.
  if (!handle.createWritable) {
    throw new Error(`workspaceLayoutFixture cannot write ${fileName}: no createWritable.`);
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** A bare (envelope-free) risk payload of roughly `targetBytes`. */
function plainRiskPayload(targetBytes: number, monthFolderName: string): string {
  const rows: Array<Record<string, unknown>> = [];
  let size = 0;
  let index = 0;
  while (size < targetBytes) {
    const row = {
      xrayImageId: `XR-${monthFolderName}-${index}`,
      portName: index % 2 === 0 ? "ميناء جدة الإسلامي" : "مطار الملك خالد",
      riskLevel: `المستوى ${(index % 4) + 1}`,
      declarationNumber: `DEC-${100000 + index}`,
      note: "بيانات تجريبية لملف قديم بدون غلاف",
    };
    rows.push(row);
    size += JSON.stringify(row).length + 1;
    index += 1;
  }
  return JSON.stringify({ monthFolderName, rowCount: rows.length, rows });
}

function monthManifest(monthFolderName: string): Record<string, unknown> {
  const [month, , year] = monthFolderName.split("-");
  return {
    monthFolderName,
    month: Number(month),
    year: Number(year),
    status: "distributed",
    totalProcessedRows: 4,
    createdAt: "2026-05-01T00:00:00.000Z",
    createdBy: "admin",
  };
}

function sampleMaster(monthFolderName: string): Record<string, unknown> {
  return {
    monthFolderName,
    drawnAt: "2026-05-02T00:00:00.000Z",
    drawnBy: "admin",
    rows: [
      { xrayImageId: `XR-${monthFolderName}-0`, portName: "ميناء جدة الإسلامي" },
      { xrayImageId: `XR-${monthFolderName}-1`, portName: "مطار الملك خالد" },
    ],
  };
}

function usersPermissionsFile(): Record<string, unknown> {
  return {
    metadata: {
      schemaVersion: "1",
      fileType: "users.permissions",
      revision: 7,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "admin",
      updatedAt: "2026-05-01T00:00:00.000Z",
      updatedBy: "admin",
      contentHash: "",
    },
    data: {
      users: [
        {
          id: "u-1",
          username: "employee1",
          displayName: "موظف ١",
          passwordHash: "argon2id$fake",
          role: "employee",
          isActive: true,
          hasCertScanLicense: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      roles: [],
      permissions: [],
      featurePermissions: [],
    },
  };
}

/**
 * Builds a memory workspace in the requested layout.
 *
 * Never call `safeWriteJson` on the plain files below — see the module note.
 */
export async function createWorkspaceFixture(
  options: WorkspaceFixtureOptions
): Promise<WorkspaceFixture> {
  const monthFolderName = options.monthFolderName ?? DEFAULT_MONTH_FOLDER;
  const plainBytes = options.plainRawFileBytes ?? DEFAULT_PLAIN_RAW_BYTES;
  const root = createMemoryDirectory("workspace-root") as DirectoryHandleLike;
  const plainFiles: Record<string, string> = {};

  const legacyRoots = options.layout === "legacy";
  const rootNames = {
    population: options.layout === "legacy" ? "Population" : "1-population",
    system: options.layout === "numbered" ? "5-system" : ".system",
    templates: options.layout === "numbered" ? "6-templates" : "templates",
  };

  // ── Population ────────────────────────────────────────────────────────────
  const monthDir = await dir(root, rootNames.population, monthFolderName);
  await safeWriteJson(monthDir, "month.manifest.json", monthManifest(monthFolderName));

  const rawFolder = legacyRoots ? "raw" : "1-raw";
  const processedFolder = legacyRoots ? "processed" : "2-processed";
  const rawDir = await dir(monthDir, rawFolder);
  const rawText = plainRiskPayload(plainBytes, monthFolderName);
  await writePlainFile(rawDir, "risk.raw.json", rawText);
  const largePlainFilePath = `${rootNames.population}/${monthFolderName}/${rawFolder}/risk.raw.json`;
  plainFiles[largePlainFilePath] = rawText;

  const processedDir = await dir(monthDir, processedFolder);
  if (legacyRoots) {
    // A pre-envelope processed payload — a second, smaller plain file.
    const finalText = JSON.stringify({
      monthFolderName,
      processedBy: "admin",
      rows: [{ xrayImageId: `XR-${monthFolderName}-0` }, { xrayImageId: `XR-${monthFolderName}-1` }],
    });
    await writePlainFile(processedDir, "population.final.json", finalText);
    plainFiles[`${rootNames.population}/${monthFolderName}/${processedFolder}/population.final.json`] =
      finalText;
  } else {
    await safeWriteJson(
      processedDir,
      "population.final.json",
      {
        monthFolderName,
        processedBy: "admin",
        rows: [{ xrayImageId: `XR-${monthFolderName}-0` }, { xrayImageId: `XR-${monthFolderName}-1` }],
      },
      { policy: PLAIN_JSON_POLICY }
    );
  }

  // ── Samples ───────────────────────────────────────────────────────────────
  if (legacyRoots) {
    // Pre-`2-samples` workspaces kept the sample master flat in the month folder.
    await safeWriteJson(monthDir, "sample.master.json", sampleMaster(monthFolderName));
  } else {
    const mainDir = await dir(root, "2-samples", monthFolderName, "1-main");
    await safeWriteJson(mainDir, "sample.master.json", sampleMaster(monthFolderName));
  }

  // ── User data (no legacy alias — same path in every layout) ───────────────
  const userDataDir = await dir(root, "3-user-data");
  await safeWriteJson(userDataDir, "users.permissions.json", usersPermissionsFile());

  // ── Templates / system ────────────────────────────────────────────────────
  const templatesDir = await dir(root, rootNames.templates);
  await safeWriteJson(templatesDir, "templates.index.json", {
    templates: [{ id: "tpl-1", name: "نموذج الفحص" }],
  });
  await dir(root, rootNames.system);

  // ── Mixed only: the stray leftover legacy population root ─────────────────
  // A newer client autosaved into an unnumbered workspace and created
  // `1-population/` next to the existing `Population/`. Both exist; the
  // numbered one wins every probe, and the older month underneath the legacy
  // folder is unreachable through workspacePaths. Seeding it here is what lets
  // a test PIN that (and notice if a walk silently starts preferring it).
  if (options.layout === "mixed") {
    const strayMonthDir = await dir(root, "Population", "1-January-2026");
    await safeWriteJson(strayMonthDir, "month.manifest.json", monthManifest("1-January-2026"));
    const strayRaw = await dir(strayMonthDir, "raw");
    const strayText = plainRiskPayload(2048, "1-January-2026");
    await writePlainFile(strayRaw, "risk.raw.json", strayText);
    plainFiles["Population/1-January-2026/raw/risk.raw.json"] = strayText;
  }

  return {
    root,
    layout: options.layout,
    monthFolderName,
    rootNames,
    plainFiles,
    largePlainFilePath,
  };
}

/** Reads a "/"-joined path from a workspace root as raw text. */
export async function readFixtureFileText(
  root: DirectoryHandleLike,
  path: string
): Promise<string> {
  const segments = path.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = await current.getDirectoryHandle(segment, { create: false });
  }
  const handle = await current.getFileHandle(segments[segments.length - 1]!, { create: false });
  const file = await handle.getFile();
  return file.text();
}

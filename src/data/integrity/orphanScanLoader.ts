/**
 * Read-only loader that gathers the five `xrayImageId` id sets B3's
 * `scanReferentialIntegrity` needs for one month, straight from disk, and runs
 * the scan. This is the only non-test caller of `scanReferentialIntegrity` —
 * see that module's docblock for the id-family definitions.
 *
 * Every family is read through an existing, already-legacy-aware loader (never
 * a raw `getDirectoryHandle`/`getFileHandle` call here), so a legacy or mixed
 * workspace layout keeps working without this file knowing about it:
 *
 *  - population — `loadMonthPopulationFinal` (population/populationStorage.ts)
 *  - sample     — `loadSampleMaster` (sampling/sampleStorage.ts)
 *  - distribution — `loadOrDeriveDistributionCurrentForRead`
 *    (distribution/distributionStorage.ts), the deduped, `persistCache: false`
 *    read-only sibling of the write-path loader. Mirrors the id-gathering that
 *    used to run inside `PopulationTab`'s Phase-2 orphan-scan effect (removed
 *    2026-08-12 for its per-render cost on a 500k-row month; see that date's
 *    edit log) — same five id sets, now computed on demand instead of on every
 *    render.
 *  - answers/approvals — `loadAllEmployeeFiles` (answers/answerStorage.ts), one
 *    scan reused for both: `items[].xrayImageId` for answers,
 *    `referralRequests[].xrayImageIds` + `replacementRequests[].originalXrayImageId`
 *    + `replacementRequests[].replacementXrayImageId` for approvals.
 *
 * Strictly read-only: no write, no cache persist, no mutation of any kind.
 */

import { loadAllEmployeeFiles } from "../answers/answerStorage";
import { loadOrDeriveDistributionCurrentForRead } from "../distribution/distributionStorage";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { scanReferentialIntegrity, type OrphanScanResult } from "./orphanScan";

function rowXrayImageId(row: Record<string, unknown>): string {
  const value = row["xrayImageId"];
  return typeof value === "string" ? value : "";
}

/**
 * Run the B3 referential-integrity scan for one month, reading every family
 * fresh from disk. Never writes anything — safe to call from a plain "scan"
 * button with no permission/mutation gate beyond read access to the workspace.
 */
export async function runMonthIntegrityScan(
  directoryHandle: DirectoryHandleLike,
  monthFolderName: string
): Promise<OrphanScanResult> {
  const population = await loadMonthPopulationFinal(directoryHandle, monthFolderName);
  const sample = await loadSampleMaster(directoryHandle, monthFolderName);
  const sampleRows = sample?.rows ?? [];

  // A6a: read-only caller — `persistCache: false` (baked into the ...ForRead
  // sibling) so this scan never triggers the fire-and-forget
  // distribution.current.json / sample-mirror write that a mutating fold does.
  const distribution = await loadOrDeriveDistributionCurrentForRead(
    directoryHandle,
    monthFolderName,
    sampleRows
  );

  const employeeFiles = await loadAllEmployeeFiles(directoryHandle, monthFolderName);
  const answersIds: string[] = [];
  const approvalsIds: string[] = [];
  for (const file of employeeFiles) {
    for (const item of file.items) answersIds.push(item.xrayImageId);
    for (const req of file.referralRequests ?? []) approvalsIds.push(...req.xrayImageIds);
    for (const req of file.replacementRequests ?? []) {
      approvalsIds.push(req.originalXrayImageId, req.replacementXrayImageId);
    }
  }

  return scanReferentialIntegrity({
    populationIds: (population?.rows ?? []).map(rowXrayImageId),
    sampleIds: sampleRows.map((row) => row.xrayImageId),
    distributionIds: (distribution?.entries ?? []).map((entry) => entry.xrayImageId),
    answersIds,
    approvalsIds,
  });
}

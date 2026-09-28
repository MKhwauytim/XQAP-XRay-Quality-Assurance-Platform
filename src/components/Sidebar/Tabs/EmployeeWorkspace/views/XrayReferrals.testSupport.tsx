/* @vitest-environment jsdom */
// Shared scaffolding for XrayReferrals tests that need a seeded workspace, a
// rendered view, and a simulated app-wide refresh broadcast — first pulled
// out here by the A1 stale-reload test (localSubmissions), reused as-is by
// later suites that need the same setup (e.g. the A1 follow-up test in
// task 18) rather than re-copied inline.
//
// `vi.mock(...)` calls are deliberately NOT re-exported from here: Vitest's
// mock hoisting only rewrites the file it is written in, so every caller
// still declares its own `vi.mock("../../../../../workers/populationQueryWorker?worker&inline", ...)`
// and `vi.mock(".../useGlobalMonth" | ".../useWorkspace", ...)` at its own
// top level, exactly as every sibling XrayReferrals test does today.
import { act, render } from "@testing-library/react";

import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { saveSampleMaster } from "../../../../../data/sampling/sampleStorage";
import { appendDistributionEvents } from "../../../../../data/distribution/distributionStorage";
import { buildAssignEvent } from "../../../../../data/distribution/distributionLog";
import { saveTemplate } from "../../../../../data/templates/templateStorage";
import { saveInspectionTemplateSelection } from "../../../../../data/templates/templateSelectionStorage";
import type { TemplateSchema } from "../../../../../data/templates/templateTypes";
import { broadcastDataRefresh } from "../../../../../data/workspace/dataRefreshSignal";
import { makePopulationRow, makeSampleMaster } from "../../../../../data/population/populationTestFixtures";
import XrayReferrals from "./XrayReferrals";

/** The one on-disk month every XrayReferrals suite seeds and selects. */
export const XRAY_REFERRALS_TEST_MONTH = "5-may-2026";

/** jsdom has no ResizeObserver; XrayReferrals' split layout needs a stub. */
export class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Seeds a one-row sample, assigns it to `assignedTo`, and installs a
 * single-field template as the active inspection template — the minimum a
 * rendered XrayReferrals needs to show one row with one answerable field.
 */
export async function seedXrayReferralsWorkspace(
  root: DirectoryHandleLike,
  opts: { xrayImageId?: string; assignedTo?: string } = {}
): Promise<void> {
  const xrayImageId = opts.xrayImageId ?? "IMG-001";
  const assignedTo = opts.assignedTo ?? "emp-a";
  const sampled = await saveSampleMaster(
    root,
    XRAY_REFERRALS_TEST_MONTH,
    makeSampleMaster([makePopulationRow(xrayImageId)])
  );
  if (!sampled.ok) throw new Error(sampled.error);
  const assigned = await appendDistributionEvents(root, XRAY_REFERRALS_TEST_MONTH, [
    buildAssignEvent({ xrayImageId, assignedTo, eventBy: "admin" }),
  ]);
  if (!assigned.ok) throw new Error(assigned.error);
  const template: TemplateSchema = {
    templateId: "tmpl-stale",
    templateName: "قالب الاختبار",
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: "admin",
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
    fields: [{ fieldId: "note", label: "ملاحظة", type: "text", required: false, options: [] }],
  };
  const savedTpl = await saveTemplate(root, template);
  if (!savedTpl.ok) throw new Error(savedTpl.error);
  const selected = await saveInspectionTemplateSelection(root, {
    templateId: template.templateId,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  });
  if (!selected.ok) throw new Error(selected.error);
}

/** Renders XrayReferrals against `root`, the same way every suite does. */
export function renderXrayReferrals(root: DirectoryHandleLike): ReturnType<typeof render> {
  return render(<XrayReferrals directoryHandle={root} />);
}

/** Fires the app-wide "re-read your data" broadcast a background refresh sends. */
export function simulateRefreshBroadcast(): void {
  act(() => broadcastDataRefresh("manual"));
}

/** Reads the "done" stat token XrayReferrals renders for the queue summary. */
export function readDoneCount(): string {
  return document.querySelector(".ew-ref-stat-token--done strong")?.textContent ?? "";
}

import { describe, expect, it } from "vitest";

import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import {
  localSubmissionKey,
  mergeLocalSubmissions,
  pruneLocalSubmissions,
  type LocalSubmission,
} from "./localSubmissions";

function item(id: string, lastSavedAt: string, status: ItemAnswer["status"] = "submitted"): ItemAnswer {
  return {
    xrayImageId: id,
    templateId: "tpl",
    templateVersion: 1,
    answers: [],
    lastSavedAt,
    submittedAt: status === "submitted" ? lastSavedAt : null,
    answeredBy: "emp1",
    status,
  };
}

function local(entries: Array<[number, ItemAnswer]>): Map<string, LocalSubmission> {
  return new Map(entries.map(([generation, answer]) => [localSubmissionKey(answer), { generation, item: answer }]));
}

describe("mergeLocalSubmissions", () => {
  it("keeps a submission newer than the load over a missing or older loaded copy", () => {
    const submitted = item("XR-1", "2026-09-28T10:00:05.000Z");
    const merged = mergeLocalSubmissions(
      [item("XR-1", "2026-09-28T09:00:00.000Z", "draft"), item("XR-2", "2026-09-28T09:00:00.000Z")],
      local([[1, submitted]]),
      0
    );
    expect(merged.find((answer) => answer.xrayImageId === "XR-1")).toBe(submitted);
    expect(merged).toHaveLength(2);

    const added = mergeLocalSubmissions([], local([[1, submitted]]), 0);
    expect(added).toEqual([submitted]);
  });

  it("trusts a load that started after the submission", () => {
    const loaded = [item("XR-1", "2026-09-28T09:00:00.000Z", "draft")];
    expect(mergeLocalSubmissions(loaded, local([[1, item("XR-1", "2026-09-28T10:00:00.000Z")]]), 1)).toBe(loaded);
  });

  it("never replaces a loaded copy that is as new or newer", () => {
    const newer = item("XR-1", "2026-09-28T11:00:00.000Z", "draft");
    const merged = mergeLocalSubmissions([newer], local([[2, item("XR-1", "2026-09-28T10:00:00.000Z")]]), 1);
    expect(merged).toEqual([newer]);
  });
});

describe("pruneLocalSubmissions", () => {
  it("drops submissions a committing load already covers", () => {
    const map = local([[1, item("XR-1", "a")], [3, item("XR-2", "b")]]);
    pruneLocalSubmissions(map, 2);
    expect([...map.keys()]).toEqual([localSubmissionKey(item("XR-2", "b"))]);
  });
});

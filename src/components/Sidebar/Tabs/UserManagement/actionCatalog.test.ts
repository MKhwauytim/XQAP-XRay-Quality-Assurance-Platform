// The filter behind the Actions viewer. Tested as a pure function rather than
// through the rendered table: each dimension has to narrow on its own AND the
// dimensions have to compose, which is a combinatorial claim that is far
// cheaper to state here than as a sequence of clicks.
import { describe, expect, it } from "vitest";

import type { WorkspaceActionEntry, WorkspaceActionType } from "../../../../data/audit/actionLog";
import { ALL_ACTION_TYPES, HIGH_VOLUME_ACTION_TYPES } from "../../../../data/audit/actionLog";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import {
  ACTION_TYPE_GROUPS,
  ACTION_TYPE_LABEL_KEYS,
  actorsInLog,
  filterActionEntries,
  isFilterActive,
  type ActionLogFilter,
} from "./actionCatalog";

let seq = 0;
function entry(over: Partial<WorkspaceActionEntry> = {}): WorkspaceActionEntry {
  seq += 1;
  return {
    id: `act-${seq}`,
    at: "2026-05-10T09:00:00.000Z",
    actor: "sara",
    actorRole: "employee",
    action: "answer-submitted",
    monthFolderName: "5-may-2026",
    target: "IMG-1",
    ...over,
  };
}

function allTypes(): Set<WorkspaceActionType> {
  return new Set(ALL_ACTION_TYPES);
}

function baseFilter(over: Partial<ActionLogFilter> = {}): ActionLogFilter {
  return { types: allTypes(), actor: "", from: "", to: "", search: "", ...over };
}

const LOG: WorkspaceActionEntry[] = [
  entry({ actor: "sara", action: "answer-submitted", at: "2026-05-01T08:00:00.000Z", target: "IMG-1" }),
  entry({ actor: "sara", action: "sample-drawn", at: "2026-05-10T08:00:00.000Z", target: "IMG-2" }),
  entry({ actor: "omar", action: "month-closed", at: "2026-05-20T08:00:00.000Z", target: "IMG-3" }),
  entry({
    actor: "omar",
    action: "answer-submitted-on-behalf",
    at: "2026-06-01T08:00:00.000Z",
    target: "IMG-4",
    details: { assignee: "sara", templateId: "tpl-1" },
  }),
];

describe("filterActionEntries", () => {
  it("passes everything through when nothing is narrowed", () => {
    expect(filterActionEntries(LOG, baseFilter())).toHaveLength(LOG.length);
  });

  it("narrows by action type", () => {
    const only = filterActionEntries(LOG, baseFilter({ types: new Set(["sample-drawn"]) }));
    expect(only.map((e) => e.action)).toEqual(["sample-drawn"]);
  });

  it("shows nothing when every type is unchecked", () => {
    // Not "show everything": an empty selection is a deliberate act by the
    // reader, and silently reinterpreting it as "no filter" would make the
    // select-none button do the opposite of what it says.
    expect(filterActionEntries(LOG, baseFilter({ types: new Set() }))).toHaveLength(0);
  });

  it("narrows by actor", () => {
    const mine = filterActionEntries(LOG, baseFilter({ actor: "omar" }));
    expect(mine).toHaveLength(2);
    expect(mine.every((e) => e.actor === "omar")).toBe(true);
  });

  it("narrows by date range, inclusive at both ends", () => {
    const may = filterActionEntries(LOG, baseFilter({ from: "2026-05-01", to: "2026-05-20" }));
    expect(may.map((e) => e.target)).toEqual(["IMG-1", "IMG-2", "IMG-3"]);
    const oneDay = filterActionEntries(LOG, baseFilter({ from: "2026-05-10", to: "2026-05-10" }));
    expect(oneDay.map((e) => e.target)).toEqual(["IMG-2"]);
  });

  it("accepts an open-ended range at either end", () => {
    expect(filterActionEntries(LOG, baseFilter({ from: "2026-05-20" }))).toHaveLength(2);
    expect(filterActionEntries(LOG, baseFilter({ to: "2026-05-01" }))).toHaveLength(1);
  });

  it("excludes an entry whose timestamp cannot be placed, but only when a range is set", () => {
    const broken = entry({ at: "not-a-date", target: "IMG-BROKEN" });
    const log = [...LOG, broken];
    expect(filterActionEntries(log, baseFilter())).toContain(broken);
    expect(filterActionEntries(log, baseFilter({ from: "2026-01-01" }))).not.toContain(broken);
  });

  it("searches target, month folder, and both the keys and values of details", () => {
    expect(filterActionEntries(LOG, baseFilter({ search: "IMG-3" })).map((e) => e.target)).toEqual(["IMG-3"]);
    expect(filterActionEntries(LOG, baseFilter({ search: "tpl-1" })).map((e) => e.target)).toEqual(["IMG-4"]);
    // The key, not just the value — `details` is the only place an entry says
    // what it is about, so "assignee" has to be findable.
    expect(filterActionEntries(LOG, baseFilter({ search: "assignee" })).map((e) => e.target)).toEqual(["IMG-4"]);
    expect(filterActionEntries(LOG, baseFilter({ search: "5-may-2026" }))).toHaveLength(4);
  });

  it("searches case-insensitively and ignores surrounding whitespace", () => {
    expect(filterActionEntries(LOG, baseFilter({ search: "  img-3  " })).map((e) => e.target)).toEqual(["IMG-3"]);
  });

  it("composes every dimension by AND", () => {
    // omar + answers-only + June + a details hit: each of these alone matches
    // more, and only their intersection is one row.
    const composed = filterActionEntries(
      LOG,
      baseFilter({
        actor: "omar",
        types: new Set(["answer-submitted", "answer-submitted-on-behalf"]),
        from: "2026-06-01",
        search: "sara",
      })
    );
    expect(composed.map((e) => e.target)).toEqual(["IMG-4"]);

    // Removing any ONE of the four dimensions widens the result — that is what
    // makes them independent rather than one filter wearing four hats.
    expect(filterActionEntries(LOG, baseFilter({ actor: "omar", from: "2026-06-01" }))).toHaveLength(1);
    expect(
      filterActionEntries(LOG, baseFilter({ types: new Set(["answer-submitted", "answer-submitted-on-behalf"]) }))
    ).toHaveLength(2);
  });

  it("leaves the source array untouched and preserves input order", () => {
    const before = LOG.map((e) => e.id);
    const filtered = filterActionEntries(LOG, baseFilter({ actor: "sara" }));
    expect(LOG.map((e) => e.id)).toEqual(before);
    expect(filtered.map((e) => e.id)).toEqual(LOG.filter((e) => e.actor === "sara").map((e) => e.id));
  });
});

describe("actorsInLog", () => {
  it("lists each actor once", () => {
    expect(actorsInLog(LOG)).toEqual(["omar", "sara"]);
  });

  it("drops blank actors rather than offering an unselectable option", () => {
    expect(actorsInLog([...LOG, entry({ actor: "" })])).toEqual(["omar", "sara"]);
  });
});

describe("isFilterActive", () => {
  it("is false only when every type is selected and nothing else is set", () => {
    expect(isFilterActive(baseFilter())).toBe(false);
  });

  it("is true for the default view, because the high-volume types are excluded", () => {
    const defaults = new Set(ALL_ACTION_TYPES.filter((t) => !HIGH_VOLUME_ACTION_TYPES.includes(t)));
    // The reader must be able to tell that rows are being withheld — a default
    // that hides ~6,500 entries a month without saying so is a lie of omission.
    expect(isFilterActive(baseFilter({ types: defaults }))).toBe(true);
  });

  it("is true when any single dimension is narrowed", () => {
    expect(isFilterActive(baseFilter({ actor: "sara" }))).toBe(true);
    expect(isFilterActive(baseFilter({ from: "2026-05-01" }))).toBe(true);
    expect(isFilterActive(baseFilter({ to: "2026-05-01" }))).toBe(true);
    expect(isFilterActive(baseFilter({ search: "img" }))).toBe(true);
  });
});

// Exhaustiveness over the union, which is what stops a newly added action type
// from rendering its raw English id to an Arabic-only reader or — worse —
// vanishing from the picker, and with it from the log the picker drives.
describe("catalog coverage", () => {
  it("gives every action type exactly one label key, and the key exists", () => {
    for (const action of ALL_ACTION_TYPES) {
      const key = ACTION_TYPE_LABEL_KEYS[action];
      expect(key, `no label key for ${action}`).toBeDefined();
      expect(DEFAULT_LABELS[key], `label key ${key} is not in DEFAULT_LABELS`).toBeTruthy();
    }
    // No stale mappings either: a removed action type must not leave behind a
    // key that quietly claims to describe something.
    expect(Object.keys(ACTION_TYPE_LABEL_KEYS).sort()).toEqual([...ALL_ACTION_TYPES].sort());
  });

  it("places every action type in exactly one filter group", () => {
    const grouped = ACTION_TYPE_GROUPS.flatMap((group) => group.types);
    // Exactly one: a duplicate renders two checkboxes for the same type whose
    // states can disagree; a missing one is unfilterable.
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...ALL_ACTION_TYPES].sort());
    for (const group of ACTION_TYPE_GROUPS) {
      expect(DEFAULT_LABELS[group.titleKey], `group title ${group.titleKey}`).toBeTruthy();
    }
  });
});

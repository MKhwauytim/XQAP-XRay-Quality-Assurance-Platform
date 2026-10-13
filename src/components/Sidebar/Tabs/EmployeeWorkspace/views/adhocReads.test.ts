import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ args: [] as unknown[][] }));

vi.mock("../../../../../data/adhocImport/adhocImportEmployeeView", () => ({
  loadAdhocEntriesForEmployeeView: async (...args: unknown[]) => {
    calls.args.push(args);
    return [];
  },
  loadAdhocAnswerItems: async () => [],
}));

import { beginAdhocReads } from "./adhocReads";

describe("beginAdhocReads", () => {
  it("passes the selected month to the ad-hoc probe", async () => {
    const dir = {} as never;
    const { entries, answers } = beginAdhocReads(dir, "emp1", false, "5-May-2026");
    expect(await entries).toEqual([]);
    expect(await answers).toEqual([]);
    expect(calls.args[0]).toEqual([dir, "emp1", false, "5-May-2026"]);
  });
});

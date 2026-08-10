/* @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { DEFAULT_LABELS } from "../labels/labelsStore";

describe("workspace handle loss messaging", () => {
  it("provides Arabic copy explaining that no data was deleted", () => {
    expect(DEFAULT_LABELS.storage_handle_lost_title).toBeTruthy();
    expect(DEFAULT_LABELS.storage_handle_lost_body).toContain("لم يتم حذف أي بيانات");
  });
});

/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { upsertItemAnswer } from "../../../../../../data/answers/answerStorage";
import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import { loadReopenLog } from "../../../../../../data/referral/referralStorage";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";
import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";
import { ReopenFilteredButton } from "./ReopenFilteredButton";

const MONTH = "5-May-2026";

function submitted(xrayImageId: string): ItemAnswer {
  const now = new Date().toISOString();
  return {
    xrayImageId, templateId: "tpl-1", templateVersion: 1, answers: [{ fieldId: "f1", value: "قيمة" }],
    lastSavedAt: now, submittedAt: now, answeredBy: "alice", status: "submitted",
  };
}

afterEach(cleanup);

describe("ReopenFilteredButton", () => {
  it("is disabled when the filter matches no submitted case of the user's own", () => {
    render(
      <ReopenFilteredButton directoryHandle={createMemoryDirectory("root")} cases={[]} username="alice" role="employee" instant={false} onDone={() => undefined} />
    );
    expect(screen.getByRole("button", { name: /طلب إعادة فتح الكل المطابق للتصفية \(0\)/ })).toBeDisabled();
  });

  it("files a pending request for every filtered case once a reason is written", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    for (const id of ["IMG-1", "IMG-2"]) await upsertItemAnswer(root, MONTH, "alice", submitted(id));
    const onDone = vi.fn();
    const cases = ["IMG-1", "IMG-2"].map((xrayImageId) => ({ monthFolderName: MONTH, xrayImageId, assignedTo: "alice" }));
    render(<ReopenFilteredButton directoryHandle={root} cases={cases} username="alice" role="employee" instant={false} onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /طلب إعادة فتح الكل المطابق للتصفية \(2\)/ }));
    // No reason yet: confirming writes nothing.
    fireEvent.click(screen.getByRole("button", { name: "طلب إعادة فتح الحالة" }));
    expect((await loadReopenLog(root, MONTH)).requests).toHaveLength(0);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "توفّرت الصور" } });
    fireEvent.click(screen.getByRole("button", { name: "طلب إعادة فتح الحالة" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("أُرسل 2 طلب إعادة فتح"));
    const log = await loadReopenLog(root, MONTH);
    expect(log.requests.map((request) => [request.xrayImageId, request.status, request.reason])).toEqual([
      ["IMG-1", "pending", "توفّرت الصور"],
      ["IMG-2", "pending", "توفّرت الصور"],
    ]);
    expect(onDone).toHaveBeenCalledWith(false);
  });
});

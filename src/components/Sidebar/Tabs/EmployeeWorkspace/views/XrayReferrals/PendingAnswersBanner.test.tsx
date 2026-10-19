/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_LABELS as L } from "../../../../../../data/labels/labelsStore";

const flush = vi.hoisted(() => vi.fn());
const count = vi.hoisted(() => ({ value: 110 }));
const fileApi = vi.hoisted(() => ({
  exportUnsentAnswers: vi.fn(async () => ({ answers: [] })),
  importUnsentAnswers: vi.fn(async () => 2),
  parseUnsentAnswersFile: vi.fn(),
  unsentAnswersFileName: () => "unsent.json",
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("../../../../../../data/answers/answerOutbox", () => ({ flushAnswersNow: flush }));
vi.mock("../../../../../../data/answers/usePendingAnswerCount", () => ({ usePendingAnswerCount: () => count.value }));
vi.mock("../../../../../../data/answers/unsentAnswersFile", () => fileApi);
vi.mock("../../../../../../utils/downloadFile", () => ({ downloadJson: download }));

import PendingAnswersBanner from "./PendingAnswersBanner";

const sent = { replayed: 2, alreadyOnDisk: 0, failed: 0, cannotLand: 0 };

describe("PendingAnswersBanner", () => {
  beforeEach(() => { count.value = 110; flush.mockReset(); download.mockReset(); });
  afterEach(cleanup);

  it("«إرسال الآن» disables while sending, then says why answers stayed unsent and offers a copy", async () => {
    let resolve!: (s: unknown) => void;
    flush.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<PendingAnswersBanner directoryHandle={{} as never} username="emp1" />);

    fireEvent.click(screen.getByRole("button", { name: L.ew_answers_send_now }));
    expect(await screen.findByRole("button", { name: L.ew_answers_sending })).toBeDisabled();

    resolve({ replayed: 0, alreadyOnDisk: 0, failed: 110, cannotLand: 0, lastError: "NotAllowedError" });
    expect(await screen.findByText(
      L.ew_answers_send_failed.replace("{count}", "110").replace("{error}", "NotAllowedError")
    )).toBeTruthy();
    expect(screen.getByText(L.ew_answers_backup_hint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: L.ew_answers_backup }));
    await vi.waitFor(() => expect(download).toHaveBeenCalledWith({ answers: [] }, "unsent.json"));
  });

  it("asks for write permission first and does not send when the browser refuses", async () => {
    const handle = { queryPermission: vi.fn(async () => "prompt"), requestPermission: vi.fn(async () => "denied") };
    render(<PendingAnswersBanner directoryHandle={handle as never} username="emp1" />);
    fireEvent.click(screen.getByRole("button", { name: L.ew_answers_send_now }));
    expect(await screen.findByText(L.ew_answers_send_permission)).toBeTruthy();
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(flush).not.toHaveBeenCalled();
  });

  it("with nothing pending shows only the import, which queues the file and sends it", async () => {
    count.value = 0;
    fileApi.parseUnsentAnswersFile.mockReturnValueOnce({ ok: true, answers: [{}, {}] });
    flush.mockResolvedValueOnce(sent);
    const { container } = render(<PendingAnswersBanner directoryHandle={{} as never} username="emp1" />);
    expect(screen.queryByRole("button", { name: L.ew_answers_send_now })).toBeNull();

    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["{}"], "unsent.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(L.ew_answers_import_done.replace("{count}", "2"))).toBeTruthy();
    expect(fileApi.importUnsentAnswers).toHaveBeenCalledWith("emp1", [{}, {}]);
    expect(screen.getByText(L.ew_answers_send_ok.replace("{count}", "2"))).toBeTruthy();
  });

  it("refuses another employee's file", async () => {
    count.value = 0;
    fileApi.parseUnsentAnswersFile.mockReturnValueOnce({ ok: false, reason: "other-user", fileUser: "emp2" });
    const { container } = render(<PendingAnswersBanner directoryHandle={{} as never} username="emp1" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["{}"], "x.json")] } });
    expect(await screen.findByText(L.ew_answers_import_other_user.replace("{user}", "emp2"))).toBeTruthy();
  });
});

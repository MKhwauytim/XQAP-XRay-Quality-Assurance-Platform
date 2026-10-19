/* @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_LABELS as L } from "../../../../../../data/labels/labelsStore";

const flush = vi.hoisted(() => vi.fn());
vi.mock("../../../../../../data/answers/answerOutbox", () => ({ flushAnswersNow: flush }));
vi.mock("../../../../../../data/answers/usePendingAnswerCount", () => ({ usePendingAnswerCount: () => 110 }));

import PendingAnswersBanner from "./PendingAnswersBanner";

describe("PendingAnswersBanner", () => {
  it("«إرسال الآن» disables while sending and then says why answers stayed unsent", async () => {
    let resolve!: (s: unknown) => void;
    flush.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<PendingAnswersBanner directoryHandle={{} as never} username="emp1" />);

    fireEvent.click(screen.getByRole("button", { name: L.ew_answers_send_now }));
    expect(screen.getByRole("button", { name: L.ew_answers_sending })).toBeDisabled();

    resolve({ replayed: 0, alreadyOnDisk: 0, failed: 110, cannotLand: 0, lastError: "NotAllowedError" });
    expect(await screen.findByText(
      L.ew_answers_send_failed.replace("{count}", "110").replace("{error}", "NotAllowedError")
    )).toBeTruthy();
    expect(screen.getByRole("button", { name: L.ew_answers_send_now })).toBeEnabled();
  });
});

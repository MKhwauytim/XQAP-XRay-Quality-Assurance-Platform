/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./subComponents";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";

const submitted: ItemAnswer = {
  xrayImageId: "X1",
  templateId: "t",
  templateVersion: 1,
  answers: [],
  lastSavedAt: "2026-10-18T10:00:00.000Z",
  submittedAt: "2026-10-18T10:00:00.000Z",
  answeredBy: "emp",
  status: "submitted",
};

describe("StatusBadge — outbox «قيد الحفظ»", () => {
  const L = getLabels();

  it("shows the saving status, not completed, while the answer is only on this device", () => {
    render(<StatusBadge answer={submitted} entryStatus="assigned" template={null} labels={L} unsynced />);
    expect(screen.getByText(L.status_saving)).toBeInTheDocument();
    expect(screen.queryByText(L.status_completed)).toBeNull();
  });

  it("shows completed once the answer is on the share", () => {
    render(<StatusBadge answer={submitted} entryStatus="assigned" template={null} labels={L} />);
    expect(screen.getByText(L.status_completed)).toBeInTheDocument();
  });
});

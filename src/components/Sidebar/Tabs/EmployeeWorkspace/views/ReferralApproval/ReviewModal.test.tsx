// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ReviewModal from "./ReviewModal";

describe("ReviewModal", () => {
  it("single-submits a supervisor decision while a slow write is pending", () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => undefined));

    render(
      <ReviewModal
        title="تأكيد الموافقة"
        description="نقل العينة"
        isApprove
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />
    );

    const button = screen.getByRole("button", { name: "تأكيد الموافقة" });
    fireEvent.click(button);
    // Simulate a second click arriving before the filesystem operation resolves.
    fireEvent.click(button);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "جارٍ حفظ القرار…" })).toBeDisabled();
  });
});

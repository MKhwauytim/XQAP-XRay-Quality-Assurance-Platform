/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModalShell } from "./ModalShell";

// `globals: false` means Testing Library never registers its own auto-cleanup,
// and a leaked ModalShell keeps a portaled dialog (and the body scroll lock) in
// document.body for the next test.
afterEach(() => {
  cleanup();
});

describe("ModalShell", () => {
  it("portals to document.body with the ew skin's class names", () => {
    const { container } = render(
      <ModalShell variant="ew" title="استبدال العينة" subtitle="تفاصيل" onClose={vi.fn()}>
        <button type="button">إلغاء</button>
      </ModalShell>
    );

    const dialog = screen.getByRole("dialog");
    // Portaled out of the caller's subtree — otherwise a transformed tab
    // wrapper becomes the containing block for the backdrop's position: fixed.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toBe("ew-modal-backdrop");
    expect(dialog.querySelector(".ew-replace-modal")).not.toBeNull();
    expect(dialog.querySelector(".ew-replace-header h3")?.textContent).toBe("استبدال العينة");
    expect(dialog.querySelector(".ew-replace-header p")?.textContent).toBe("تفاصيل");
  });

  it("renders the arc skin with an h2 title and a kicker", () => {
    render(
      <ModalShell variant="arc" eyebrow="استعادة النسخة" title="استعادة نسخة احتياطية" onClose={vi.fn()}>
        <p>body</p>
      </ModalShell>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toBe("arc-modal-backdrop");
    expect(dialog.querySelector(".arc-restore-header h2")?.textContent).toBe("استعادة نسخة احتياطية");
    expect(dialog.querySelector(".arc-panel-kicker")?.textContent).toBe("استعادة النسخة");
  });

  it("names the dialog after its own title via aria-labelledby", () => {
    render(
      <ModalShell variant="ew" title="إسناد لموظف آخر" onClose={vi.fn()}>
        <p>body</p>
      </ModalShell>
    );

    expect(screen.getByRole("dialog", { name: "إسناد لموظف آخر" })).toBeInTheDocument();
  });

  it("gives two concurrent shells distinct title ids", () => {
    render(
      <>
        <ModalShell variant="ew" title="الأول" onClose={vi.fn()}>
          <p>a</p>
        </ModalShell>
        <ModalShell variant="ew" title="الثاني" onClose={vi.fn()}>
          <p>b</p>
        </ModalShell>
      </>
    );

    const [first, second] = screen.getAllByRole("dialog");
    expect(first.getAttribute("aria-labelledby")).not.toBe(second.getAttribute("aria-labelledby"));
    expect(screen.getByRole("dialog", { name: "الأول" })).toBe(first);
    expect(screen.getByRole("dialog", { name: "الثاني" })).toBe(second);
  });

  it("closes on the X button and on Escape, and traps focus", () => {
    const onClose = vi.fn();
    render(
      <ModalShell variant="ew" title="عنوان" onClose={onClose}>
        <button type="button">إجراء</button>
      </ModalShell>
    );

    // useFocusTrap moves focus to the first focusable control — the close button.
    const close = screen.getByRole("button", { name: "إغلاق" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not dismiss on a backdrop click — these dialogs hold unsaved input", () => {
    const onClose = vi.fn();
    render(
      <ModalShell variant="ew" title="عنوان" onClose={onClose}>
        <textarea defaultValue="سبب" />
      </ModalShell>
    );

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks and restores body scroll around its lifetime", () => {
    const view = render(
      <ModalShell variant="ew" title="عنوان" onClose={vi.fn()}>
        <p>body</p>
      </ModalShell>
    );

    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

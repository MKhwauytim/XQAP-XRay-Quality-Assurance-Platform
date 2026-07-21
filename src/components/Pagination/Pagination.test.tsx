/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Pagination from "./Pagination";

afterEach(cleanup);

describe("Pagination", () => {
  it("commits direct page input only on blur or Enter", () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} totalItems={500} onPageChange={onPageChange} />);
    const input = screen.getByRole("spinbutton", { name: "رقم الصفحة" });

    fireEvent.change(input, { target: { value: "" } });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(null);

    fireEvent.blur(input);
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input).toHaveValue(2);

    fireEvent.change(input, { target: { value: "4" } });
    expect(onPageChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPageChange).toHaveBeenCalledWith(4);
  });
});

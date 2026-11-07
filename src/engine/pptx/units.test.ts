import { describe, expect, it } from "vitest";
import { EMU_PER_PX, emu, inFromPx, ptFromPx } from "./units";

describe("pptx units", () => {
  it("units", () => {
    expect(EMU_PER_PX).toBe(6350);
    expect(emu(64)).toBe(406400);
    expect(ptFromPx(44)).toBe(22);
    expect(inFromPx(144)).toBe(1);
    expect(emu(inFromPx(1920) * 144)).toBe(12192000);
  });
});

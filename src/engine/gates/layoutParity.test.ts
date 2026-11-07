import { describe, expect, it } from "vitest";
import { checkLayoutParity } from "./layoutParity";

describe("checkLayoutParity", () => {
  const h = new Map([[1, [{ id: "a", x: 100, y: 100, lines: 1, text: "x" }]]]);
  const at = (dx: number, lines = 1) => new Map([[1, [{ id: "a", x: 100 + dx, y: 100, lines, text: "x" }]]]);

  it("flags a 3px move and an extra a:br, accepts 2px", () => {
    expect(checkLayoutParity(h, at(2))).toEqual([]);
    expect(checkLayoutParity(h, at(3))[0]).toMatchObject({ rule: "gate.layoutParity", page: 1 });
    expect(checkLayoutParity(h, at(0, 2))[0].rule).toBe("gate.layoutParity");
  });

  it("with the layout as a third source, a drift both writers share is caught", () => {
    const layout = new Map([[1, [{ id: "a", x: 95, y: 100, lines: 1, text: "" }]]]);
    expect(checkLayoutParity(h, h, 2, new Map([[1, [{ id: "a", x: 100, y: 100, lines: 1, text: "" }]]]))).toEqual([]);
    const r = checkLayoutParity(h, h, 2, layout);
    expect(r.map((i) => i.detail)).toEqual(["top-left layout (95, 100) HTML (100, 100)", "top-left layout (95, 100) PPTX (100, 100)"]);
  });

  it("flags a box present on one side only", () => {
    expect(checkLayoutParity(h, new Map([[1, []]]))).toEqual([{ rule: "gate.layoutParity", page: 1, path: "a", detail: "missing in PPTX" }]);
  });
});

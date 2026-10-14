// src/data/reporting/executive/portKind.test.ts
import { describe, expect, it } from "vitest";
import { portKindOf, resolvePortKinds } from "./portKind";

describe("resolvePortKinds", () => {
  it("takes the majority non-blank type, whatever the row order", () => {
    const rows = [
      { portName: "أ", portType: "منفذ بري" },
      { portName: "أ", portType: "منفذ بحري" },
      { portName: "أ", portType: "منفذ بحري" },
    ];
    expect(resolvePortKinds(rows).get("أ")).toBe("sea");
    expect(resolvePortKinds([...rows].reverse()).get("أ")).toBe("sea");
  });

  it("ignores blank types when counting the majority", () => {
    const kinds = resolvePortKinds([
      { portName: "ب", portType: "" },
      { portName: "ب", portType: null },
      { portName: "ب", portType: "   " },
      { portName: "ب", portType: "منفذ بري" },
    ]);
    expect(kinds.get("ب")).toBe("land");
  });

  it("marks a port with only blank types unknown, never land", () => {
    const kinds = resolvePortKinds([{ portName: "ج", portType: null }, { portName: "ج", portType: "" }]);
    expect(kinds.get("ج")).toBe("unknown");
  });

  it("breaks a tie toward sea, deterministically", () => {
    const kinds = resolvePortKinds([{ portName: "د", portType: "منفذ بري" }, { portName: "د", portType: "منفذ بحري" }]);
    expect(kinds.get("د")).toBe("sea");
  });

  it("files a blank port name under «غير محدد» and reports an unseen port as unknown", () => {
    const kinds = resolvePortKinds([{ portName: null, portType: "منفذ بري" }]);
    expect(kinds.get("غير محدد")).toBe("land");
    expect(portKindOf(kinds, "منفذ آخر")).toBe("unknown");
  });
});

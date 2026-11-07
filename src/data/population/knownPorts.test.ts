import { describe, expect, it } from "vitest";
import { mergeKnownPorts, UNCATEGORIZED_PORT_TYPE } from "../distribution/portEligibility";
import type { PortAllocation } from "../sampling/sampleTypes";
import type { PreparedPopulationRow } from "./populationTypes";
import { knownPortsFromSamples } from "./knownPorts";

const alloc = (portName: string, populationSize: number) => ({ portName, populationSize }) as PortAllocation;
const sampled = (portName: string, portType: string | null) => ({ portName, portType }) as PreparedPopulationRow;

describe("knownPortsFromSamples", () => {
  it("lists every port of every month, the latest month winning count and type", () => {
    const ports = knownPortsFromSamples([
      { portAllocations: [alloc("A", 10), alloc("B", 5)], rows: [sampled("A", "بري"), sampled("B", "بحري")] },
      { portAllocations: [alloc("A", 30), alloc("C", 2)], rows: [sampled("A", "بري")] },
    ]);
    expect(ports).toEqual([
      { portName: "A", portType: "بري", rowCount: 30 },
      { portName: "B", portType: "بحري", rowCount: 5 },
      { portName: "C", portType: null, rowCount: 2 },
    ]);
  });
});

describe("mergeKnownPorts", () => {
  it("adds known ports missing from this month's catalog under their own type, keeping this month's entries", () => {
    const merged = mergeKnownPorts(
      [{ category: "بري", ports: [{ portName: "A", rowCount: 7 }] }],
      [
        { portName: "A", portType: "بري", rowCount: 30 },
        { portName: "B", portType: "بحري", rowCount: 5 },
        { portName: "C", portType: null, rowCount: 2 },
        { portName: "D", portType: "بري", rowCount: 9 },
      ]
    );
    expect(merged).toEqual([
      { category: "بحري", ports: [{ portName: "B", rowCount: 5 }] },
      { category: "بري", ports: [{ portName: "D", rowCount: 9 }, { portName: "A", rowCount: 7 }] },
      { category: UNCATEGORIZED_PORT_TYPE, ports: [{ portName: "C", rowCount: 2 }] },
    ].sort((a, b) => a.category.localeCompare(b.category, "ar")));
  });

  it("with no file uploaded yet, the known ports alone are the catalog", () => {
    expect(mergeKnownPorts([], [{ portName: "A", portType: "بري", rowCount: 3 }]))
      .toEqual([{ category: "بري", ports: [{ portName: "A", rowCount: 3 }] }]);
  });
});

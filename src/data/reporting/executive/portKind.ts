/**
 * The ONE rule that decides whether a port is land (بري), sea (بحري) or undetermined, used by every executive
 * report page that splits ports by type. Before this, some pages took the first row's «نوع المنفذ» per port
 * (order-dependent) and others decided per row, and a blank type silently defaulted to land.
 *
 * Rule: a port's kind is the majority of its rows' NON-BLANK «نوع المنفذ» values (a value containing «بحري» is
 * sea, any other non-blank value is land). A tie goes to sea, deterministically. A port whose rows all carry a
 * blank type is "unknown" (shown as «غير محدد»), never land by default.
 */
export type PortKind = "land" | "sea" | "unknown";

/** Label for ports whose type cannot be determined from the data. */
export const UNKNOWN_PORT_KIND_LABEL = "غير محدد";

/** Fallback port name — the same literal the per-port folds use for a blank port name. */
const UNKNOWN_PORT_NAME = "غير محدد";

export function resolvePortKinds(
  rows: Iterable<{ portName?: string | null; portType?: string | null }>,
): Map<string, PortKind> {
  const tally = new Map<string, { sea: number; land: number }>();
  for (const r of rows) {
    const name = r.portName ?? UNKNOWN_PORT_NAME;
    const t = tally.get(name) ?? { sea: 0, land: 0 };
    tally.set(name, t);
    const type = (r.portType ?? "").trim();
    if (type === "") continue;
    if (type.includes("بحري")) t.sea++;
    else t.land++;
  }
  const out = new Map<string, PortKind>();
  for (const [name, t] of tally) out.set(name, t.sea === 0 && t.land === 0 ? "unknown" : t.sea >= t.land ? "sea" : "land");
  return out;
}

/** Kind of one port from a resolved map; a port the map never saw is "unknown". */
export function portKindOf(kinds: Map<string, PortKind>, name: string): PortKind {
  return kinds.get(name) ?? "unknown";
}

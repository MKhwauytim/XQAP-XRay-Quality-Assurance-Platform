import type { ExecutiveReportRow } from "../executiveReportTypes";

export type PortEmployeeStat = {
  employeeId: string;
  /** rows where this employee was the assessor at the given level, for this port */
  studied: number;
  /** count of those rows whose ORIGINAL level result was اشتباه */
  suspicious: number;
  /** count of those rows whose ORIGINAL level result was سليمة */
  clean: number;
  /** accuracy% = (rows where this assessor's level result matched expertResult)
   *  / (studied rows that have a verificationCategory), or null if none verified */
  accuracy: number | null;
};

export type PortEmployeeGroup = {
  level: "one" | "two";
  levelLabel: string;          // "المستوى الأول" | "المستوى الثاني"
  employees: PortEmployeeStat[]; // sorted by studied desc, then accuracy desc
};

export type PortEmployeeAnalysis = {
  portName: string;
  portType: "land" | "sea";
  population: number;          // total rows for this port
  levelOne: PortEmployeeGroup;
  levelTwo: PortEmployeeGroup;
  hasAnyEmployees: boolean;    // false → page is skipped
};

function safePct(num: number, den: number): number | null {
  return den === 0 ? null : (num / den) * 100;
}

/**
 * Build one stat block per assessor for a single port at a single level.
 * `level` selects which employee id and which accuracy flag to read.
 */
function buildLevelGroup(
  portRows: ExecutiveReportRow[],
  level: "one" | "two",
): PortEmployeeGroup {
  // accumulator keyed by employeeId
  const acc = new Map<string, {
    studied: number; suspicious: number; clean: number;
    verified: number; correct: number;
  }>();

  for (const r of portRows) {
    const emp = level === "one" ? r.levelOneEmployeeId : r.levelTwoEmployeeId;
    if (!emp) continue;
    const rec = acc.get(emp) ?? { studied: 0, suspicious: 0, clean: 0, verified: 0, correct: 0 };
    rec.studied++;
    const result = level === "one" ? r.levelOneResult : r.levelTwoResult;
    if (result === "اشتباه") rec.suspicious++;
    else rec.clean++;
    // accuracy only over rows with an expert verdict
    if (r.verificationCategory !== null) {
      rec.verified++;
      const accurate = level === "one" ? r.levelOneAccurate : r.levelTwoAccurate;
      if (accurate === true) rec.correct++;
    }
    acc.set(emp, rec);
  }

  const employees: PortEmployeeStat[] = [...acc.entries()].map(([employeeId, rec]) => ({
    employeeId,
    studied: rec.studied,
    suspicious: rec.suspicious,
    clean: rec.clean,
    accuracy: safePct(rec.correct, rec.verified),
  })).sort((a, b) =>
    b.studied - a.studied || (b.accuracy ?? -1) - (a.accuracy ?? -1)
  );

  return {
    level,
    levelLabel: level === "one" ? "المستوى الأول" : "المستوى الثاني",
    employees,
  };
}

/**
 * Group all rows by portName and produce one analysis per port.
 * Land ports first (sorted by population desc), then sea ports.
 * portType falls back to a name heuristic when row.portType is null.
 */
export function buildPortEmployeeAnalyses(
  rows: ExecutiveReportRow[],
): PortEmployeeAnalysis[] {
  const byPort = new Map<string, ExecutiveReportRow[]>();
  for (const r of rows) {
    const port = r.portName ?? "غير محدد";
    if (!byPort.has(port)) byPort.set(port, []);
    byPort.get(port)!.push(r);
  }

  const analyses: PortEmployeeAnalysis[] = [...byPort.entries()].map(([portName, portRows]) => {
    const typeFromRow = portRows.find(r => r.portType)?.portType as ("land" | "sea" | undefined);
    const portType: "land" | "sea" =
      typeFromRow === "land" || typeFromRow === "sea"
        ? typeFromRow
        : (portName.includes("ميناء") ? "sea" : "land");
    const levelOne = buildLevelGroup(portRows, "one");
    const levelTwo = buildLevelGroup(portRows, "two");
    return {
      portName,
      portType,
      population: portRows.length,
      levelOne,
      levelTwo,
      hasAnyEmployees: levelOne.employees.length > 0 || levelTwo.employees.length > 0,
    };
  });

  // Land first (pop desc), then sea (pop desc).
  const rank = (a: PortEmployeeAnalysis) => (a.portType === "land" ? 0 : 1);
  return analyses
    .filter(a => a.hasAnyEmployees)
    .sort((a, b) => rank(a) - rank(b) || b.population - a.population);
}

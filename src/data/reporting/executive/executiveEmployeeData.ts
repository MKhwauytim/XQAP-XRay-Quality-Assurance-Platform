import type { ExecutiveReportRow } from "../executiveReportTypes";

export type EmployeeProfile = {
  username: string;
  studied: number;
  workload: number;
  overallAccuracy: number | null;
  suspiciousDetectionRate: number | null;
  missedSuspicionRate: number | null;
  excessSuspicionRate: number | null;
  levelOneAccuracy: number | null;
  levelTwoAccuracy: number | null;
  byPort: Map<string, { studied: number; accuracy: number | null }>;
  byDecision: { onSuspicious: number | null; onClean: number | null };
  byImageQuality: Record<"عالي" | "متوسط" | "منخفض", { studied: number; accuracy: number | null }>;
  byMarking: { marked: { studied: number; accuracy: number | null }; unmarked: { studied: number; accuracy: number | null } };
  stabilityIndex: number | null;
  reliable: boolean;
  riskScore: number;
  recommendedAction: string;
};

function safeRate(num: number, den: number): number | null {
  return den === 0 ? null : (num / den) * 100;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

export function buildEmployeeProfiles(
  rows: ExecutiveReportRow[],
  minimumReliableSampleSize = 30,
): EmployeeProfile[] {
  // Group submitted rows by evaluator
  const groups = new Map<string, ExecutiveReportRow[]>();
  for (const row of rows) {
    if (row.answerStatus !== "submitted") continue;
    const emp = (row as ExecutiveReportRow & { answeredBy?: string | null }).answeredBy ?? row.assignedTo;
    if (!emp) continue;
    if (!groups.has(emp)) groups.set(emp, []);
    groups.get(emp)!.push(row);
  }

  return [...groups.entries()].map(([username, empRows]) => {
    const withVerif = empRows.filter(r => r.verificationCategory !== null);
    const studied = withVerif.length;
    const workload = empRows.length;

    const correct = withVerif.filter(r => r.imageResultAccurate).length;
    const overallAccuracy = safeRate(correct, studied);

    const suspRows = withVerif.filter(r => ["correct-suspicious","missed-suspicious"].includes(r.verificationCategory!));
    const suspiciousDetectionRate = safeRate(withVerif.filter(r => r.verificationCategory === "correct-suspicious").length, suspRows.length);
    const missedSuspicionRate = safeRate(withVerif.filter(r => r.verificationCategory === "missed-suspicious").length, suspRows.length);
    const excessSuspicionRate = safeRate(
      withVerif.filter(r => r.verificationCategory === "excess-suspicious").length,
      withVerif.filter(r => ["correct-suspicious","excess-suspicious"].includes(r.verificationCategory!)).length,
    );

    const levelOneAccuracy = safeRate(withVerif.filter(r => r.levelOneAccurate).length, studied);
    const levelTwoAccuracy = safeRate(withVerif.filter(r => r.levelTwoAccurate).length, studied);

    // byPort
    const byPort = new Map<string, { studied: number; accuracy: number | null }>();
    for (const r of withVerif) {
      const port = r.portName ?? "غير محدد";
      const rec = byPort.get(port) ?? { studied: 0, accuracy: null, _correct: 0 } as { studied: number; accuracy: number | null; _correct: number };
      rec.studied++;
      if (r.imageResultAccurate) (rec as { studied: number; accuracy: number | null; _correct: number })._correct++;
      byPort.set(port, rec);
    }
    for (const [port, rec] of byPort) {
      const r = rec as { studied: number; accuracy: number | null; _correct: number };
      byPort.set(port, { studied: r.studied, accuracy: safeRate(r._correct, r.studied) });
    }

    // byDecision
    const onSuspRows = withVerif.filter(r => r.expertResult === "اشتباه");
    const onCleanRows = withVerif.filter(r => r.expertResult === "سليمة");
    const byDecision = {
      onSuspicious: safeRate(onSuspRows.filter(r => r.imageResultAccurate).length, onSuspRows.length),
      onClean: safeRate(onCleanRows.filter(r => r.imageResultAccurate).length, onCleanRows.length),
    };

    // byImageQuality
    const byImageQuality = {
      "عالي": { studied: 0, accuracy: null as number | null, _correct: 0 },
      "متوسط": { studied: 0, accuracy: null as number | null, _correct: 0 },
      "منخفض": { studied: 0, accuracy: null as number | null, _correct: 0 },
    } as Record<"عالي"|"متوسط"|"منخفض", { studied: number; accuracy: number|null; _correct: number }>;
    for (const r of withVerif) {
      if (r.imageQuality && r.imageQuality in byImageQuality) {
        byImageQuality[r.imageQuality].studied++;
        if (r.imageResultAccurate) byImageQuality[r.imageQuality]._correct++;
      }
    }
    for (const q of ["عالي","متوسط","منخفض"] as const) {
      byImageQuality[q].accuracy = safeRate(byImageQuality[q]._correct, byImageQuality[q].studied);
    }

    // byMarking
    const markedRows = withVerif.filter(r => r.hasMarking === true);
    const unmarkedRows = withVerif.filter(r => r.hasMarking === false);
    const byMarking = {
      marked: { studied: markedRows.length, accuracy: safeRate(markedRows.filter(r => r.imageResultAccurate).length, markedRows.length) },
      unmarked: { studied: unmarkedRows.length, accuracy: safeRate(unmarkedRows.filter(r => r.imageResultAccurate).length, unmarkedRows.length) },
    };

    // stabilityIndex — stdev of per-port accuracy
    const portAccuracies = [...byPort.values()].map(p => p.accuracy).filter((a): a is number => a !== null);
    const stabilityIndex = portAccuracies.length >= 2 ? stdev(portAccuracies) : null;

    const reliable = studied >= minimumReliableSampleSize;

    // riskScore: higher = more concern
    let riskScore = 0;
    if (overallAccuracy !== null && overallAccuracy < 90) riskScore += (90 - overallAccuracy) * 2;
    if (missedSuspicionRate !== null && missedSuspicionRate > 5) riskScore += missedSuspicionRate * 3;
    if (stabilityIndex !== null && stabilityIndex > 15) riskScore += stabilityIndex;

    const recommendedAction =
      !reliable ? "بيانات غير كافية للتقييم" :
      missedSuspicionRate !== null && missedSuspicionRate > 10 ? "مراجعة عاجلة — اشتباه فائت مرتفع" :
      overallAccuracy !== null && overallAccuracy < 80 ? "تدريب مكثف — دقة منخفضة" :
      overallAccuracy !== null && overallAccuracy < 90 ? "متابعة دورية — دقة دون الهدف" :
      "أداء مستقر";

    return {
      username, studied, workload, overallAccuracy, suspiciousDetectionRate, missedSuspicionRate,
      excessSuspicionRate, levelOneAccuracy, levelTwoAccuracy,
      byPort, byDecision,
      byImageQuality: byImageQuality as Record<"عالي"|"متوسط"|"منخفض", { studied: number; accuracy: number|null }>,
      byMarking, stabilityIndex, reliable, riskScore, recommendedAction,
    };
  }).sort((a, b) => (b.overallAccuracy ?? -1) - (a.overallAccuracy ?? -1));
}

export function buildPriorityList(profiles: EmployeeProfile[]): EmployeeProfile[] {
  return [...profiles].sort((a, b) => b.riskScore - a.riskScore).filter(p => p.reliable);
}

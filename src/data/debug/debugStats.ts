/** Shared min/avg/max summary for a bounded list of millisecond samples — used
 *  by both the live panel and the exported report so the two never drift. */
export type MsStats = { avgMs: number; maxMs: number; sampleCount: number };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarizeMs(values: number[]): MsStats {
  if (values.length === 0) return { avgMs: 0, maxMs: 0, sampleCount: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    avgMs: round1(sum / values.length),
    maxMs: round1(Math.max(...values)),
    sampleCount: values.length,
  };
}

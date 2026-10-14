/**
 * In-memory step timings for the answers submit/load/flush paths. Used by the
 * owner's measurement protocol (Settings -> download). Never written to the share.
 */
export type AnswerTiming = {
  name: string;
  ms: number;
  at: string;
  detail?: Record<string, string | number>;
};

export const ANSWER_TIMING_RING_MAX = 300;

const ring: AnswerTiming[] = [];

function record(name: string, start: number, detail?: AnswerTiming["detail"]): void {
  const entry: AnswerTiming = {
    name,
    ms: Math.max(0, performance.now() - start),
    at: new Date().toISOString(),
  };
  if (detail) entry.detail = detail;
  ring.push(entry);
  while (ring.length > ANSWER_TIMING_RING_MAX) ring.shift();
}

export async function timeAnswerStep<T>(
  name: string,
  work: () => Promise<T>,
  detail?: AnswerTiming["detail"],
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    record(name, start, detail);
  }
}

export function getAnswerTimings(): readonly AnswerTiming[] {
  return ring;
}

export function answerTimingsToJson(): string {
  return JSON.stringify(ring, null, 2);
}

export function __resetAnswerTimingsForTests(): void {
  ring.length = 0;
}

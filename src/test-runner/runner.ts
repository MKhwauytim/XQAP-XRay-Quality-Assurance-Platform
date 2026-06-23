// ── Test runner engine ────────────────────────────────────────────────────────

export type TestStatus = "idle" | "running" | "pass" | "fail" | "skip";

export type TestResult = {
  id: string;
  suite: string;
  name: string;
  status: TestStatus;
  message?: string;
  expected?: string;
  actual?: string;
  durationMs?: number;
};

export type TestSuite = {
  name: string;
  tests: TestDefinition[];
};

export type TestDefinition = {
  name: string;
  fn: () => void | Promise<void>;
  skip?: boolean;
};

export class AssertionError extends Error {
  expected: string;
  actual: string;
  constructor(message: string, expected: string, actual: string) {
    super(message);
    this.expected = expected;
    this.actual = actual;
  }
}

export function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new AssertionError(
          `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`,
          String(expected),
          String(actual)
        );
      }
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new AssertionError(
          `Deep equality failed`,
          JSON.stringify(expected),
          JSON.stringify(actual)
        );
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new AssertionError("Expected null", "null", String(actual));
      }
    },
    toNotBeNull() {
      if (actual === null) {
        throw new AssertionError("Expected non-null value", "non-null", "null");
      }
    },
    toContain(sub: string) {
      if (typeof actual !== "string" || !actual.includes(sub)) {
        throw new AssertionError(
          `Expected "${actual}" to contain "${sub}"`,
          `contains "${sub}"`,
          String(actual)
        );
      }
    },
    toMatch(re: RegExp) {
      if (typeof actual !== "string" || !re.test(actual)) {
        throw new AssertionError(
          `Expected "${actual}" to match ${re}`,
          `matches ${re}`,
          String(actual)
        );
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new AssertionError("Expected truthy", "truthy", String(actual));
      }
    },
    toBeGreaterThan(n: number) {
      if (typeof actual !== "number" || actual <= n) {
        throw new AssertionError(`Expected > ${n}`, `> ${n}`, String(actual));
      }
    },
  };
}

export async function runSuite(
  suite: TestSuite,
  onResult: (r: TestResult) => void
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const test of suite.tests) {
    const id = `${suite.name}::${test.name}`;
    if (test.skip) {
      const r: TestResult = { id, suite: suite.name, name: test.name, status: "skip" };
      results.push(r);
      onResult(r);
      continue;
    }
    const t0 = performance.now();
    try {
      await test.fn();
      const r: TestResult = {
        id, suite: suite.name, name: test.name,
        status: "pass", durationMs: Math.round(performance.now() - t0),
      };
      results.push(r);
      onResult(r);
    } catch (err) {
      const r: TestResult = {
        id, suite: suite.name, name: test.name, status: "fail",
        message: err instanceof Error ? err.message : String(err),
        expected: err instanceof AssertionError ? err.expected : undefined,
        actual:   err instanceof AssertionError ? err.actual   : undefined,
        durationMs: Math.round(performance.now() - t0),
      };
      results.push(r);
      onResult(r);
    }
  }
  return results;
}

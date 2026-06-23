import { useEffect, useRef, useState } from "react";
import { runSuite, type TestResult, type TestStatus } from "./runner";
import { permissionSuite } from "./suites/permissionSuite";
import { dataSuite } from "./suites/dataSuite";
import { labelSuite } from "./suites/labelSuite";
import "./TestPanel.css";

const ALL_SUITES = [permissionSuite, dataSuite, labelSuite];

const STATUS_ICON: Record<TestStatus, string> = {
  idle:    "○",
  running: "◌",
  pass:    "✓",
  fail:    "✗",
  skip:    "—",
};

function statusClass(s: TestStatus) {
  return `tp-status tp-status-${s}`;
}

type SuiteStats = { total: number; pass: number; fail: number; skip: number; running: boolean };

function calcStats(results: TestResult[], suiteNames: string[]): Record<string, SuiteStats> {
  const map: Record<string, SuiteStats> = {};
  for (const name of suiteNames) {
    map[name] = { total: 0, pass: 0, fail: 0, skip: 0, running: false };
  }
  for (const r of results) {
    const s = map[r.suite];
    if (!s) continue;
    s.total++;
    if (r.status === "pass") s.pass++;
    else if (r.status === "fail") s.fail++;
    else if (r.status === "skip") s.skip++;
    else if (r.status === "running") s.running = true;
  }
  return map;
}

export function TestPanel() {
  const [visible, setVisible] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState(false);
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set(ALL_SUITES.map((s) => s.name)));
  const [filter, setFilter] = useState<"all" | "fail" | "pass">("all");
  const abortRef = useRef(false);

  // Ctrl+Shift+T to toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === "T") {
        e.preventDefault();
        setVisible((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runAll() {
    setRunning(true);
    abortRef.current = false;
    setResults([]);

    for (const suite of ALL_SUITES) {
      if (abortRef.current) break;
      await runSuite(suite, (r) => {
        setResults((prev) => {
          const idx = prev.findIndex((x) => x.id === r.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = r;
            return next;
          }
          return [...prev, r];
        });
      });
    }
    setRunning(false);
  }

  function stop() {
    abortRef.current = true;
    setRunning(false);
  }

  function toggleSuite(name: string) {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const suiteNames = ALL_SUITES.map((s) => s.name);
  const stats = calcStats(results, suiteNames);

  const totalPass = results.filter((r) => r.status === "pass").length;
  const totalFail = results.filter((r) => r.status === "fail").length;
  const totalSkip = results.filter((r) => r.status === "skip").length;
  const totalAll  = results.length;

  const filteredResults = filter === "all"
    ? results
    : results.filter((r) => r.status === filter);

  if (!visible) {
    return (
      <button
        className="tp-fab"
        title="Test Runner (Ctrl+Shift+T)"
        onClick={() => setVisible(true)}
        aria-label="فتح لوحة الاختبار"
      >
        🧪
      </button>
    );
  }

  return (
    <div className="tp-panel" role="dialog" aria-label="Test Runner">
      <div className="tp-header">
        <span className="tp-title">🧪 Test Runner</span>
        <div className="tp-header-actions">
          {running ? (
            <button className="tp-btn tp-btn-stop" onClick={stop}>⏹ إيقاف</button>
          ) : (
            <button className="tp-btn tp-btn-run" onClick={runAll} disabled={running}>
              ▶ تشغيل الكل
            </button>
          )}
          <button className="tp-btn tp-btn-close" onClick={() => setVisible(false)} aria-label="إغلاق">×</button>
        </div>
      </div>

      {totalAll > 0 && (
        <div className="tp-summary">
          <span className="tp-stat tp-stat-pass">✓ {totalPass}</span>
          <span className="tp-stat tp-stat-fail">✗ {totalFail}</span>
          {totalSkip > 0 && <span className="tp-stat tp-stat-skip">— {totalSkip}</span>}
          <span className="tp-stat tp-stat-total">/ {totalAll}</span>
          <div className="tp-filter-tabs">
            {(["all", "pass", "fail"] as const).map((f) => (
              <button
                key={f}
                className={`tp-filter${filter === f ? " active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "الكل" : f === "pass" ? "ناجح" : "فاشل"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tp-body">
        {ALL_SUITES.map((suite) => {
          const s = stats[suite.name];
          const suiteResults = filteredResults.filter((r) => r.suite === suite.name);
          const expanded = expandedSuites.has(suite.name);
          const suiteAllResults = results.filter((r) => r.suite === suite.name);
          const hasFail = suiteAllResults.some((r) => r.status === "fail");
          const allPass = suiteAllResults.length > 0 && suiteAllResults.every((r) => r.status === "pass" || r.status === "skip");

          return (
            <div key={suite.name} className={`tp-suite${hasFail ? " tp-suite-fail" : allPass ? " tp-suite-pass" : ""}`}>
              <button
                className="tp-suite-header"
                onClick={() => toggleSuite(suite.name)}
                aria-expanded={expanded}
              >
                <span className="tp-suite-chevron">{expanded ? "▾" : "▸"}</span>
                <span className="tp-suite-name">{suite.name}</span>
                {s && s.total > 0 && (
                  <span className="tp-suite-stats">
                    {s.fail > 0 && <span className="tp-badge tp-badge-fail">{s.fail} فاشل</span>}
                    <span className="tp-badge tp-badge-pass">{s.pass} ناجح</span>
                    <span className="tp-badge tp-badge-total">/ {s.total}</span>
                  </span>
                )}
              </button>

              {expanded && (
                <ul className="tp-test-list">
                  {suiteResults.length === 0 && (
                    <li className="tp-test-empty">
                      {results.length === 0 ? "لم يتم تشغيل الاختبارات بعد" : "لا توجد نتائج تطابق الفلتر"}
                    </li>
                  )}
                  {suiteResults.map((r) => (
                    <li key={r.id} className={`tp-test-item tp-test-${r.status}`}>
                      <span className={statusClass(r.status)}>{STATUS_ICON[r.status]}</span>
                      <span className="tp-test-name">{r.name}</span>
                      {r.durationMs !== undefined && (
                        <span className="tp-test-dur">{r.durationMs}ms</span>
                      )}
                      {r.status === "fail" && r.message && (
                        <div className="tp-test-error">
                          <span className="tp-test-error-msg">{r.message}</span>
                          {r.expected && (
                            <span className="tp-test-diff">
                              <em>متوقع:</em> {r.expected} <em>فعلي:</em> {r.actual}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="tp-footer">
        <span className="tp-hint">Ctrl+Shift+T لإغلاق/فتح</span>
      </div>
    </div>
  );
}

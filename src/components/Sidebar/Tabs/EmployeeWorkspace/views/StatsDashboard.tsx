import { useCallback, useEffect, useState } from "react";
import { readSession } from "../../../../../auth/authSession";
import { loadEmployeeAnswers } from "../../../../../data/answers/answerStorage";
import { PageHeader } from "../../../../../components/PageHeader/PageHeader";
import { loadOrDeriveDistributionCurrent } from "../../../../../data/distribution/distributionStorage";
import type { DistributionCurrentData } from "../../../../../data/distribution/distributionTypes";
import { listMonthFolders } from "../../../../../data/population/populationStorage";
import { readUserManagementState } from "../../../../../auth/userManagement";
import type { DirectoryHandleLike } from "../../../../../data/storage/fileSystemAccess";
import { loadSampleMaster } from "../../../../../data/sampling/sampleStorage";

type Props = { directoryHandle: DirectoryHandleLike };

type EmployeeStat = {
  username: string;
  displayName: string;
  assigned: number;
  submitted: number;
  draft: number;
  notStarted: number;
  completionPct: number;
};

function pct(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 100);
}

export default function StatsDashboard({ directoryHandle }: Props) {
  const session = readSession();
  const username = session?.username ?? "";
  const role = session?.role ?? "employee";
  const isAdmin = role === "admin" || role === "supervisor";

  const [availableMonths, setAvailableMonths] = useState<
    Array<{ month: number; year: number; folderName: string }>
  >([]);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [dist, setDist] = useState<DistributionCurrentData | null>(null);
  const [stats, setStats] = useState<EmployeeStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void listMonthFolders(directoryHandle).then((months) => {
      setAvailableMonths(months);
      if (months.length > 0) setSelectedMonth(months[months.length - 1]!.folderName);
    });
  }, [directoryHandle]);

  const loadStats = useCallback(async () => {
    if (!selectedMonth) return;
    setLoading(true);

    const sample = await loadSampleMaster(directoryHandle, selectedMonth);
    const distribution = sample
      ? await loadOrDeriveDistributionCurrent(directoryHandle, selectedMonth, sample.rows)
      : null;
    setDist(distribution);

    if (!distribution) { setStats([]); setLoading(false); return; }

    const userState = readUserManagementState();
    const displayMap = new Map(
      userState.users.map((u) => [u.username, u.displayName])
    );

    // Collect unique employees visible to the current viewer
    const employeeNames = isAdmin
      ? [...new Set(distribution.entries.map((e) => e.assignedTo))]
      : [username];

    // Load all answer files in parallel
    const answerFiles = await Promise.all(
      employeeNames.map((u) => loadEmployeeAnswers(directoryHandle, selectedMonth, u))
    );

    const result: EmployeeStat[] = employeeNames.map((u, idx) => {
      const entries = distribution.entries.filter((e) => e.assignedTo === u);
      const answers = answerFiles[idx]!.items;
      const submitted = answers.filter((a) => a.status === "submitted").length;
      const draft     = answers.filter((a) => a.status === "draft").length;
      const notStarted = entries.length - submitted - draft;
      return {
        username: u,
        displayName: displayMap.get(u) ?? u,
        assigned: entries.length,
        submitted,
        draft: Math.max(0, draft),
        notStarted: Math.max(0, notStarted),
        completionPct: pct(submitted, entries.length),
      };
    });

    setStats(result);
    setLoading(false);
  }, [directoryHandle, selectedMonth, username, isAdmin]);

  useEffect(() => { void loadStats(); }, [loadStats]);

  // Aggregate totals
  const totals = stats.reduce(
    (acc, s) => ({
      assigned:    acc.assigned    + s.assigned,
      submitted:   acc.submitted   + s.submitted,
      draft:       acc.draft       + s.draft,
      notStarted:  acc.notStarted  + s.notStarted,
    }),
    { assigned: 0, submitted: 0, draft: 0, notStarted: 0 }
  );
  const overallPct = pct(totals.submitted, totals.assigned);

  return (
    <section className="ew-page" dir="rtl">
      <PageHeader
        eyebrow="Statistics Dashboard"
        title="لوحة الإحصائيات"
        subtitle="نظرة عامة على تقدم العمل وإحصائيات الإنجاز."
      />

      {/* Month selector */}
      <div className="ew-controls">
        <label className="ew-label" htmlFor="stats-month">
          الشهر
          <select
            id="stats-month"
            className="ew-select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {availableMonths.map((m) => (
              <option key={m.folderName} value={m.folderName}>{m.folderName}</option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="ew-empty">جاري التحميل...</p>
      ) : !dist ? (
        <p className="ew-empty">لا توجد بيانات توزيع لهذا الشهر.</p>
      ) : (
        <>
          {/* KPI strip */}
          <div className="ew-stats-kpi-grid">
            <KpiCard
              label="إجمالي المحالة"
              value={totals.assigned}
              color="#17365d"
            />
            <KpiCard
              label="مكتملة"
              value={totals.submitted}
              color="#059669"
              sub={`${overallPct}%`}
            />
            <KpiCard
              label="مسودة"
              value={totals.draft}
              color="#d97706"
            />
            <KpiCard
              label="لم تُبدأ"
              value={totals.notStarted}
              color="#dc2626"
            />
          </div>

          {/* Progress bar */}
          <div className="ew-stats-progress-wrap">
            <div className="ew-stats-progress-label">
              <span>نسبة الإنجاز الكلية</span>
              <strong style={{ color: overallPct === 100 ? "#059669" : overallPct >= 60 ? "#d97706" : "#dc2626" }}>
                {overallPct}%
              </strong>
            </div>
            <div className="ew-stats-progress-bg">
              <div
                className="ew-stats-progress-fill"
                style={{
                  width: `${overallPct}%`,
                  background: overallPct === 100 ? "#059669" : overallPct >= 60 ? "#d97706" : "#dc2626",
                }}
              />
            </div>
          </div>

          {/* Per-employee breakdown (admin/supervisor only) */}
          {isAdmin && stats.length > 0 && (
            <div className="ew-stats-table-wrap">
              <h3 className="ew-stats-table-title">توزيع الإنجاز حسب الموظف</h3>
              <div className="ew-stats-table">
                <div className="ew-stats-header">
                  <span>الموظف</span>
                  <span>المحالة</span>
                  <span>مكتملة</span>
                  <span>مسودة</span>
                  <span>لم تُبدأ</span>
                  <span>الإنجاز</span>
                </div>
                {stats.map((s) => (
                  <div key={s.username} className="ew-stats-row">
                    <span className="ew-stats-name">
                      <span className="ew-stats-avatar">{(s.displayName || s.username)[0]?.toUpperCase()}</span>
                      <span>
                        <strong>{s.displayName}</strong>
                        {s.displayName !== s.username && (
                          <small style={{ display: "block", color: "var(--p-muted)", fontSize: 11 }}>
                            {s.username}
                          </small>
                        )}
                      </span>
                    </span>
                    <span className="ew-stats-num">{s.assigned.toLocaleString("ar-SA-u-nu-latn")}</span>
                    <span className="ew-stats-num" style={{ color: "#059669", fontWeight: 700 }}>
                      {s.submitted.toLocaleString("ar-SA-u-nu-latn")}
                    </span>
                    <span className="ew-stats-num" style={{ color: "#d97706" }}>
                      {s.draft.toLocaleString("ar-SA-u-nu-latn")}
                    </span>
                    <span className="ew-stats-num" style={{ color: s.notStarted > 0 ? "#dc2626" : "var(--p-muted)" }}>
                      {s.notStarted.toLocaleString("ar-SA-u-nu-latn")}
                    </span>
                    <span className="ew-stats-pct-cell">
                      <div className="ew-stats-mini-bar-bg">
                        <div
                          className="ew-stats-mini-bar-fill"
                          style={{
                            width: `${s.completionPct}%`,
                            background: s.completionPct === 100 ? "#059669" : s.completionPct >= 60 ? "#d97706" : "#dc2626",
                          }}
                        />
                      </div>
                      <span style={{
                        fontSize: 12, fontWeight: 700,
                        color: s.completionPct === 100 ? "#059669" : s.completionPct >= 60 ? "#d97706" : "#dc2626",
                      }}>
                        {s.completionPct}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function KpiCard({
  label, value, color, sub,
}: {
  label: string; value: number; color: string; sub?: string;
}) {
  return (
    <div className="ew-kpi-card">
      <span className="ew-kpi-label">{label}</span>
      <strong className="ew-kpi-value" style={{ color }}>{value.toLocaleString("ar-SA-u-nu-latn")}</strong>
      {sub && <span className="ew-kpi-sub">{sub}</span>}
    </div>
  );
}

import type { DistributionCurrentData } from "../distribution/distributionTypes";
import { buildReportHtml, escHtml, formatDate, formatNum } from "./htmlReport";

export function buildDistributionReport(
  data: DistributionCurrentData,
  monthFolderName: string
): string {
  // Group by employee
  const byEmployee = new Map<
    string,
    { pending: number; completed: number; replaced: number; requested: number }
  >();

  for (const entry of data.entries) {
    const emp = entry.assignedTo;
    if (!byEmployee.has(emp)) {
      byEmployee.set(emp, {
        pending: 0,
        completed: 0,
        replaced: 0,
        requested: 0
      });
    }
    const stats = byEmployee.get(emp)!;
    if (entry.status === "pending") stats.pending++;
    else if (entry.status === "completed") stats.completed++;
    else if (entry.status === "replaced") stats.replaced++;
    else if (entry.status === "replacement-requested") stats.requested++;
  }

  const empRows = Array.from(byEmployee.entries())
    .map(([emp, s]) => {
      const total = s.pending + s.completed + s.replaced + s.requested;
      return `<tr>
        <td>${escHtml(emp)}</td>
        <td>${formatNum(total)}</td>
        <td>${formatNum(s.pending)}</td>
        <td>${formatNum(s.completed)}</td>
        <td>${formatNum(s.requested)}</td>
        <td>${formatNum(s.replaced)}</td>
      </tr>`;
    })
    .join("");

  const statusLabel = (s: string): string => {
    const m: Record<string, string> = {
      pending: "قيد الانتظار",
      completed: "مكتمل",
      replaced: "مستبدل",
      "replacement-requested": "طلب استبدال"
    };
    return m[s] ?? s;
  };

  const detailRows = data.entries
    .map(
      (e) =>
        `<tr>
          <td>${escHtml(e.xrayImageId)}</td>
          <td>${escHtml(e.assignedTo)}</td>
          <td>${escHtml(e.row.portName ?? "")}</td>
          <td>${escHtml(e.row.certScanStatus)}</td>
          <td>${escHtml(statusLabel(e.status))}</td>
          <td>${formatDate(e.lastEventAt)}</td>
        </tr>`
    )
    .join("");

  const body = `
<p class="meta">الشهر: ${escHtml(monthFolderName)} — تم التوليد: ${formatDate(data.derivedAt)}</p>

<div class="stat-grid">
  <div class="stat-card"><div class="stat-label">إجمالي المعينة</div><div class="stat-value">${formatNum(data.totalAssigned)}</div></div>
  <div class="stat-card"><div class="stat-label">قيد الانتظار</div><div class="stat-value">${formatNum(data.totalPending)}</div></div>
  <div class="stat-card"><div class="stat-label">مكتملة</div><div class="stat-value">${formatNum(data.totalCompleted)}</div></div>
  <div class="stat-card"><div class="stat-label">مستبدلة</div><div class="stat-value">${formatNum(data.totalReplaced)}</div></div>
</div>

<h2>ملخص الموظفين</h2>
<table>
  <thead>
    <tr>
      <th>الموظف</th>
      <th>الإجمالي</th>
      <th>قيد الانتظار</th>
      <th>مكتمل</th>
      <th>طلب استبدال</th>
      <th>مستبدل</th>
    </tr>
  </thead>
  <tbody>${empRows}</tbody>
</table>

<h2>تفاصيل التوزيع</h2>
<table>
  <thead>
    <tr>
      <th>معرف الأشعة</th>
      <th>الموظف</th>
      <th>المنفذ</th>
      <th>CertScan</th>
      <th>الحالة</th>
      <th>آخر حدث</th>
    </tr>
  </thead>
  <tbody>${detailRows}</tbody>
</table>`;

  return buildReportHtml(`تقرير التوزيع — ${monthFolderName}`, body);
}

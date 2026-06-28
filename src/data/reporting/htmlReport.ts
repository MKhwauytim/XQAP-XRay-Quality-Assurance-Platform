// Shared utility for building self-contained Arabic RTL HTML reports

export function buildReportHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    direction: rtl;
    color: #1a2333;
    background: #f8fafc;
    padding: 32px;
  }
  h1 { font-size: 22px; color: #17365d; margin-bottom: 4px; }
  h2 { font-size: 16px; color: #17365d; margin: 28px 0 12px; border-bottom: 2px solid #dce4ee; padding-bottom: 6px; }
  h3 { font-size: 14px; color: #344059; margin: 16px 0 8px; }
  .meta { font-size: 12px; color: #667085; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 20px; }
  th { background: #17365d; color: #fff; padding: 8px 12px; text-align: right; font-weight: 600; }
  td { padding: 7px 12px; border-bottom: 1px solid #e2e8f0; }
  tr:nth-child(even) td { background: #f8fafc; }
  .total-row td { font-weight: 700; background: #eef2f8 !important; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .badge-warn { background: #fef9c3; color: #854d0e; }
  .badge-muted { background: #f1f5f9; color: #64748b; }
  .stat-grid { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .stat-card { background: #fff; border: 1px solid #dce4ee; border-radius: 8px; padding: 14px 18px; min-width: 120px; }
  .stat-label { font-size: 11px; color: #667085; }
  .stat-value { font-size: 24px; font-weight: 700; color: #17365d; }
  @page {
    size: portrait;
    margin: 0;
  }
  @media print {
    body { background: #fff; padding: 15mm 20mm; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<h1>${escHtml(title)}</h1>
${body}
</body>
</html>`;
}

export function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function openOrDownload(html: string, filename: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (w) {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  // Fallback: download
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function formatNum(n: number): string {
  return n.toLocaleString("ar-SA-u-nu-latn");
}

export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-SA-u-nu-latn");
  } catch {
    return iso;
  }
}

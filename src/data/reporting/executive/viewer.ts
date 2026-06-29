import { EXEC_CSS } from "./theme";
import { esc } from "./primitives";

export function buildViewerHtml(slides: string, sidebarLinks: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — ${esc(monthLabel)}</title>
<style>${EXEC_CSS}</style>
</head>
<body>
<div class="xr-viewer">
  <main class="xr-slides">${slides}</main>
  <nav class="xr-sidebar">
    <div class="xr-brand">
      <strong>التقرير التنفيذي</strong>
      <span>ضمان جودة الأشعة</span>
    </div>
    <button class="xr-pdf-btn" onclick="window.print()">تصدير PDF</button>
    <div class="xr-nav-title">الأقسام</div>
    <div class="xr-nav">${sidebarLinks}</div>
  </nav>
</div>
</body>
</html>`;
}

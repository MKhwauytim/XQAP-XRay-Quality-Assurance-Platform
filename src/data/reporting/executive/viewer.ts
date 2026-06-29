import { EXEC_CSS } from "./theme";
import { esc } from "./primitives";

export function buildViewerHtml(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>التقرير التنفيذي — ${esc(monthLabel)}</title>
<style>${EXEC_CSS}</style>
</head>
<body>
<div class="xr-toolbar">
  <button class="xr-pdf-btn" onclick="window.print()">🖨 تصدير PDF</button>
</div>
<div class="xr-document">
${slides}
</div>
</body>
</html>`;
}

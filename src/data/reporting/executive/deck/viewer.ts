// Deck viewer wrapper (design §6). Wraps the joined slides in a self-contained
// landscape HTML document with a sticky toolbar (print / PDF) and a tiny TOC-less
// review chrome. No runtime scaling. The print rule (deckTheme.ts) sets the 16:9
// `@page` so each slide prints one-per-page.

import { DECK_CSS } from "./deckTheme";
import { esc } from "../primitives";
import { icon } from "../ui/icons";
import { SOURCE_REVISIONS_CSS } from "../../sourceRevisions";
import { ARABIC_FONT_FACE_CSS } from "../../../../branding/fonts";

export function buildDeckHtml(slides: string, monthLabel: string, footerNote = ""): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${ARABIC_FONT_FACE_CSS}${DECK_CSS}${SOURCE_REVISIONS_CSS}</style>
</head>
<body>
<div class="deck-viewer">
  <div class="deck-toolbar">
    <div class="deck-brand">
      <div class="brand-mark">${icon("shield", 22)}</div>
      <div>
        <strong>العرض التنفيذي</strong>
        <span>ضمان جودة الأشعة — ${esc(monthLabel)}</span>
      </div>
    </div>
    <div class="deck-toolbar-actions">
      <label class="theme-toggle" title="التبديل بين الوضع الفاتح والداكن" dir="ltr">
        <input type="checkbox" onchange="document.body.classList.toggle('theme-light', this.checked)"/>
        <span class="theme-toggle-track">
          <span class="theme-toggle-icon moon">${icon("moon", 13)}</span>
          <span class="theme-toggle-icon sun">${icon("sun", 13)}</span>
          <span class="theme-toggle-thumb"></span>
        </span>
      </label>
      <button class="btn" onclick="window.print()" title="اختر «حفظ كـ PDF» من المتصفح عند الطباعة، وليس «Microsoft Print to PDF»، لضمان الحجم والجودة الصحيحين">طباعة / PDF</button>
    </div>
  </div>
${slides}
${footerNote}
</div>
</body>
</html>`;
}

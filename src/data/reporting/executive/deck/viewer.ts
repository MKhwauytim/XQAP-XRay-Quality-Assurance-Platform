// Deck viewer wrapper (design §6). Wraps the joined slides in a self-contained
// landscape HTML document with a sticky toolbar (print / PDF) and a tiny TOC-less
// review chrome. No runtime scaling. The print rule (deckTheme.ts) sets the 16:9
// `@page` so each slide prints one-per-page.

import { DECK_CSS } from "./deckTheme";
import { esc } from "../primitives";
import { icon } from "../ui/icons";

export function buildDeckHtml(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${DECK_CSS}</style>
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
    <button class="btn" onclick="window.print()">طباعة / PDF</button>
  </div>
${slides}
</div>
</body>
</html>`;
}

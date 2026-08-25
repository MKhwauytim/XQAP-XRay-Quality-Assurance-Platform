import { buildReportModel } from "../model/reportModel";
import { buildDeck3Slides } from "./slides";
import { DECK_V3_CSS } from "./theme";
import { ARABIC_FONT_FACE_CSS } from "../../../../branding/fonts";
import { openReportWindow, writeOrCloseOnFailure } from "../../htmlReport";
import { formatMonthFolderShortLabel } from "../../../population/monthFolder";
import type { ExecutiveReportInput } from "../../executiveReportTypes";

export function buildDeckV3Html(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>العرض التنفيذي — ${monthLabel}</title>
<style>${ARABIC_FONT_FACE_CSS}${DECK_V3_CSS}</style>
</head>
<body>
<div class="deck-viewer-v3">
${slides}
</div>
</body>
</html>`;
}

export async function buildExecutiveDeckV3(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<string> {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = await buildDeck3Slides(model, formatMonthFolderShortLabel(input.monthFolderName), input.config.monthlyTarget);
  return buildDeckV3Html(slides, formatMonthFolderShortLabel(input.monthFolderName));
}

export async function openExecutiveDeckV3(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): Promise<void> {
  const reportWindow = openReportWindow();
  await writeOrCloseOnFailure(
    reportWindow,
    () => buildExecutiveDeckV3(input, employeeDisplayNames),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}

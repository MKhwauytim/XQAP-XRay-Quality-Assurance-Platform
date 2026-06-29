import { buildExecutiveReportRows, calculateExecutiveKPIs } from "../executiveReportData";
import { buildContext } from "./context";
import { assembleReport } from "./assemble";
import { openOrDownload } from "../htmlReport";
import type { ExecutiveReportInput } from "../executiveReportTypes";

import { buildCover }             from "./pages/cover";
import { buildToc }               from "./pages/toc";
import { buildGlossary }          from "./pages/glossary";
import {
  buildPart1Divider,
  buildPart2Divider,
  buildPart3Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk }  from "./pages/populationByRisk";
import { buildPopulationByLevel } from "./pages/populationByLevel";
import { buildSampleByLevel }     from "./pages/sampleByLevel";
import { buildAccuracyByPort }    from "./pages/accuracyByPort";
import { buildAccuracyByLevel }   from "./pages/accuracyByLevel";
import { buildEmpImageQuality, buildEmpImageQualityImpact } from "./pages/empImageQuality";
import { buildSuspectCategories } from "./pages/suspectCategories";
import { buildAnalyticsMap }      from "./pages/analyticsMap";
import { buildDistributionOverview } from "./pages/distributionOverview";
import { buildLevelAgreement }    from "./pages/levelAgreement";
import { buildEmpOverview }       from "./pages/empOverview";
import { buildEmpByDecision }     from "./pages/empByDecision";
import { buildEmpByPort, buildEmpCrossPort } from "./pages/empByPort";
import { buildEmpStability }      from "./pages/empStability";
import { buildErrorTypes }        from "./pages/errorTypes";
import { buildEmpPriority }       from "./pages/empPriority";
import { buildAppendix }          from "./pages/appendix";

// execIntro is kept but excluded from the page list (intro data is on cover now)
// Re-export for backwards compatibility if any external caller needs it
export { buildExecIntro } from "./pages/execIntro";

export function buildExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const rows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);
  const ctx  = buildContext(input, kpis, employeeDisplayNames, rows);

  // 23-page order matching HTML mockup v4:
  // 01 Cover
  // 02 TOC
  // 03 Glossary
  // 04 Part 1 Divider — مجتمع الحالات
  // 05 Population by Risk (port type split)
  // 06 Population by Level (stage × port)
  // 07 Sample by Level
  // 08 Part 2 Divider — نتائج الفحص
  // 09 Accuracy by Port
  // 10 Accuracy by Level
  // 11 Image Quality Results (global)
  // 12 Suspect Categories & Smuggle Methods
  // 13 Part 3 Divider — التحاليل المتقدمة
  // 14 Analytics Map
  // 15 Employee Overview
  // 16 Employee by Decision Type
  // 17 Employee by Port (example port drill-down)
  // 18 Cross-Port Comparison (matrix)
  // 19 Performance Stability & Workload
  // 20 Image Quality Impact on Performance
  // 21 Error Type Analysis
  // 22 Level Agreement (L1 vs L2)
  // 23 Priority & Actions
  // 24 Appendix / Distribution Overview
  const pages = [
    buildCover,
    buildToc,
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    buildPopulationByLevel,
    buildSampleByLevel,
    buildPart2Divider,
    buildAccuracyByPort,
    buildAccuracyByLevel,
    buildEmpImageQuality,
    buildSuspectCategories,
    buildPart3Divider,
    buildAnalyticsMap,
    buildEmpOverview,
    buildEmpByDecision,
    buildEmpByPort,
    buildEmpCrossPort,
    buildEmpStability,
    buildEmpImageQualityImpact,
    buildErrorTypes,
    buildLevelAgreement,
    buildEmpPriority,
    buildDistributionOverview,
    buildAppendix,
  ];

  return assembleReport(ctx, pages);
}

export function openExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(
    buildExecutiveReport(input, employeeDisplayNames),
    `التقرير_التنفيذي_${input.monthFolderName}.html`,
  );
}

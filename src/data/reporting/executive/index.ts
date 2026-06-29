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
import { buildDistributionOverview } from "./pages/distributionOverview";
import { buildLevelAgreement }    from "./pages/levelAgreement";
import { buildEmpOverview }       from "./pages/empOverview";
import { buildEmpByDecision }     from "./pages/empByDecision";
import { buildEmpByPort }         from "./pages/empByPort";
import { buildEmpImageQuality }   from "./pages/empImageQuality";
import { buildEmpStability }      from "./pages/empStability";
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

  // Page order matches the HTML mockup v4 layout:
  // Intro (cover) → TOC → Glossary
  // Part 1: population community
  // Part 2: inspection results
  // Part 3: advanced analytics
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
    buildDistributionOverview,
    buildPart3Divider,
    buildEmpOverview,
    buildEmpByDecision,
    buildEmpByPort,
    buildEmpImageQuality,
    buildEmpStability,
    buildLevelAgreement,
    buildEmpPriority,
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

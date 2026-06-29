import { buildExecutiveReportRows, calculateExecutiveKPIs } from "../executiveReportData";
import { buildContext } from "./context";
import { assembleReport } from "./assemble";
import { openOrDownload } from "../htmlReport";
import type { ExecutiveReportInput } from "../executiveReportTypes";

// Phase 1 pages
import { buildCover } from "./pages/cover";
import { buildToc } from "./pages/toc";
import { buildExecIntro } from "./pages/execIntro";
import { buildGlossary } from "./pages/glossary";
import {
  buildPart1Divider, buildPart2Divider, buildPart3Divider,
  buildPart4Divider, buildPart5Divider, buildPart6Divider,
} from "./pages/partDivider";
import { buildPopulationByRisk } from "./pages/populationByRisk";
import { buildPopulationByLevel } from "./pages/populationByLevel";
import { buildSampleByLevel } from "./pages/sampleByLevel";
import { buildAppendix } from "./pages/appendix";

export function buildExecutiveReport(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const rows = buildExecutiveReportRows(input);
  const kpis = calculateExecutiveKPIs(rows, input.sample, input.config);
  const ctx = buildContext(input, kpis, employeeDisplayNames);

  const pages = [
    buildCover,
    buildToc,
    buildExecIntro,
    buildGlossary,
    buildPart1Divider,
    buildPopulationByRisk,
    buildPopulationByLevel,
    buildPart2Divider,
    buildSampleByLevel,
    buildPart3Divider,
    // distributionOverview — Phase 2
    buildPart4Divider,
    // accuracyByPort — Phase 3
    // accuracyByLevel — Phase 3
    // levelAgreement — Phase 3
    buildPart5Divider,
    // empOverview … — Phase 4
    buildPart6Divider,
    // empPriority — Phase 4
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

// Domain types live in src/data; re-exported here for component consumers.
export type {
  CertScanEntry,
  CertScanMatchStatus,
  BiEnrichmentStatus,
  PreparedPopulationRow,
  RemovedPopulationRow,
  BiFieldFillSummary,
  ProcessingSummary,
  PopulationProcessingResult,
} from "../../../../../data/population/populationTypes";

import type { BiWorkbookResult } from "../biData/biDataTypes";
import type { RiskWorkbookResult } from "../riskData/riskDataTypes";

// Stays here: depends on UI-tree workbook types.
export type PopulationProcessingInput = {
  riskWorkbookResult: RiskWorkbookResult;
  biWorkbookResult: BiWorkbookResult | null;
  certScanPasteText: string;
};

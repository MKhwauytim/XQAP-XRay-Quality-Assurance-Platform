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
  /**
   * C2: ports flagged CertScan as a whole (`PopulationConfig.certScanPorts`).
   * A row is CertScan when its port is listed here OR its id matches the
   * pasted device list. Optional — omitted means no port is flagged.
   */
  certScanPorts?: readonly string[];
};

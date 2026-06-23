import type { BiWorkbookResult } from "../components/Sidebar/Tabs/Population/biData/biDataTypes";
import type { RiskWorkbookResult } from "../components/Sidebar/Tabs/Population/riskData/riskDataTypes";

export type WorkbookWorkerRequest = {
  riskFile: File;
  biFile: File | null;
  riskSheetPatterns?: string[];
  biSheetPatterns?: string[];
  columnMappings?: Record<string, string[]>;
  biColumnMappings?: Record<string, string[]>;
};

export type WorkbookWorkerResponse =
  | { type: "progress"; message: string }
  | { type: "done"; riskResult: RiskWorkbookResult; biResult: BiWorkbookResult | null; warning?: string }
  | { type: "error"; error: string };

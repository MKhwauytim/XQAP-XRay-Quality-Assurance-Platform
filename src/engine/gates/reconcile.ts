import type { ProcessedDataset } from "../data/processing";
import type { EngineIssue } from "../errors";
import type { XlsxStepCounts } from "./readBack";

/**
 * M12: raw rows minus each step's removed rows equals processed rows. Checked on the counts the workbook's step
 * sheets show (B4:D4) against the engine's step records, and along the chain from raw count to processed rows.
 */
export function checkReconciliation(processed: Map<string, ProcessedDataset>, xlsxSteps: XlsxStepCounts[]): EngineIssue[] {
  const out: EngineIssue[] = [];
  const issue = (path: string, detail: string): void => { out.push({ rule: "gate.reconcile", path, detail }); };
  for (const [id, pd] of processed) {
    let expectIn = pd.rawCount;
    for (const rec of pd.steps) {
      const path = `${id}.${rec.stepId}`;
      const shown = xlsxSteps.find((s) => s.datasetId === id && s.stepId === rec.stepId);
      if (rec.inCount !== expectIn) issue(path, `engine in ${rec.inCount} != ${expectIn}`);
      if (rec.inCount - rec.removed !== rec.outCount) issue(path, `engine ${rec.inCount} - ${rec.removed} != ${rec.outCount}`);
      if (shown === undefined) issue(path, "step sheet missing");
      else {
        if (shown.inCount - shown.removed !== shown.outCount) issue(path, `sheet ${shown.inCount} - ${shown.removed} != ${shown.outCount}`);
        if (shown.inCount !== rec.inCount || shown.removed !== rec.removed || shown.outCount !== rec.outCount) {
          issue(path, `sheet ${shown.inCount}/${shown.removed}/${shown.outCount} != engine ${rec.inCount}/${rec.removed}/${rec.outCount}`);
        }
      }
      expectIn = rec.outCount;
    }
    if (expectIn !== pd.rows.length) issue(id, `after steps ${expectIn} != processed ${pd.rows.length}`);
  }
  return out;
}

import type { RawFile, RawSheet } from "../data/types";
import type { EngineIssue } from "../errors";
import { issueReport } from "../issue/issueReport";
import type { IssueEnv, IssueResult } from "../issue/issueReport";
import { formatIssue } from "../messages";
import type { IssueParams } from "../spec/types";
import { LONG_DASH } from "../text";
import { buildSpecFromPicks } from "./bind";
import type { PickBinding, PicksBase } from "./bind";
import { DEMO_NOTE } from "./designs/demo";
import { parsePicksSheet, parsePicksText } from "./picks";

function refuse(issues: EngineIssue[], params: IssueParams): IssueResult {
  return { ok: false, issues, message: formatIssue(issues[0]!, params.messages).replace(LONG_DASH, "-") };
}

/**
 * Department picks to every file: parse the numbers, bind them into a spec, issue it. Each stage can refuse;
 * a refusal returns the issues and no file (M13). The recipe stores the bound spec, so reissueFromRecipe
 * needs nothing from here.
 */
export async function issueFromPicks(
  picks: string | RawSheet, bindings: PickBinding[], base: PicksBase, files: RawFile[], params: IssueParams, env: IssueEnv,
): Promise<IssueResult> {
  // F3: the demo label never ships in a real report, whether it sits in the files, the picks text or the base.
  if (JSON.stringify([picks, bindings, base, files]).includes(DEMO_NOTE)) return refuse([{ rule: "catalog.demoLabel" }], params);
  const parsed = typeof picks === "string" ? parsePicksText(picks) : parsePicksSheet(picks);
  if (!parsed.ok) return refuse(parsed.issues, params);
  const built = buildSpecFromPicks(parsed.numbers, bindings, base);
  if (!built.ok) return refuse(built.issues, params);
  return issueReport(built.spec, files, params, env);
}

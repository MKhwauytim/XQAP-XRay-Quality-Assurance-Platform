import { issueReport, reissueFromRecipe } from "./issue/issueReport";
import { validateRecipe } from "./recipe/recipe";
import { validateSpec } from "./spec/validate";

export const ENGINE_ACTIONS = ["author", "run", "view"] as const;
export type EngineAction = (typeof ENGINE_ACTIONS)[number];

/** The three engine actions (decision 13) and the entry points behind each. Hosts gate who may call which. */
export const ENGINE_ACTION_MAP: {
  author: typeof validateSpec;
  run: { issueReport: typeof issueReport; reissueFromRecipe: typeof reissueFromRecipe };
  view: typeof validateRecipe;
} = {
  author: validateSpec,
  run: { issueReport, reissueFromRecipe },
  view: validateRecipe,
};

import { applySteps } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import { profileColumns } from "../data/profile";
import type { ColumnProfile, RawFile } from "../data/types";
import { typeDataset } from "../data/typing";
import { layoutReport } from "../layout/layoutReport";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import type { LayoutDoc } from "../layout/types";
import { resolveVisuals } from "../resolve/resolve";
import { FIXTURE_FILES, twoSlideFixture } from "./twoSlide";
import type { Fixture } from "./twoSlide";

export interface Case { f: Fixture; files: RawFile[] }

export function run({ f, files }: Case) {
  const data = new Map<string, ProcessedDataset>();
  const profiles = new Map<string, ColumnProfile[]>();
  f.spec.datasets.forEach((def, i) => {
    const { data: typed } = typeDataset(def, files);
    profiles.set(def.id, profileColumns(typed, def));
    data.set(def.id, applySteps(typed, def, f.params, i));
  });
  const r = resolveVisuals(f.spec, data, profiles, f.params);
  const doc = layoutReport(f.spec, r.visuals, r.values, f.params, f.theme, createFixedAdvanceMeasurer());
  return { doc, values: r.values };
}

export const layoutOf = (c: Case): LayoutDoc => run(c).doc;
export const layoutFixture = (): LayoutDoc => layoutOf({ f: twoSlideFixture(), files: FIXTURE_FILES });

export function withText(s: string): Case {
  const f = twoSlideFixture();
  f.spec.pages[0].visuals[0].text = s;
  return { f, files: FIXTURE_FILES };
}

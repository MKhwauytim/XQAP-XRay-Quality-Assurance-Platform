import { expect, test } from "vitest";

import { resolveStageMappings, getStageKey } from "./stageHelpers";
import { DEFAULT_STAGE_MAPPINGS } from "./populationConfig";

test("resolveStageMappings returns the defaults when no override is given", () => {
  expect(resolveStageMappings()).toEqual(DEFAULT_STAGE_MAPPINGS);
});

test("resolveStageMappings merges a partial override on top of the defaults", () => {
  const resolved = resolveStageMappings({ first: ["مرحلة اولى مخصصة"] });

  expect(resolved.first).toEqual(["مرحلة اولى مخصصة"]);
  expect(resolved.second).toEqual(DEFAULT_STAGE_MAPPINGS.second);
});

test("resolveStageMappings is exactly what getStageKey uses internally (same resolution for the same inputs)", () => {
  const override = { first: ["CUSTOM-FIRST"] };
  const resolved = resolveStageMappings(override);

  expect(getStageKey("CUSTOM-FIRST", override)).toBe("first");
  expect(resolved.first).toContain("CUSTOM-FIRST");
});

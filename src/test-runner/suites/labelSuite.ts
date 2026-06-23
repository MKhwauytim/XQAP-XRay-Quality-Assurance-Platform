import { DEFAULT_LABELS, getLabels, setLabel, resetLabel, resetAllLabels } from "../../data/labels/labelsStore";
import { expect, type TestSuite } from "../runner";

const ALL_KEYS = Object.keys(DEFAULT_LABELS) as (keyof typeof DEFAULT_LABELS)[];

export const labelSuite: TestSuite = {
  name: "Labels",
  tests: [
    {
      name: "DEFAULT_LABELS has at least 50 keys",
      fn() { expect(ALL_KEYS.length).toBeGreaterThan(50); },
    },
    {
      name: "getLabels returns a value for every DEFAULT_LABELS key",
      fn() {
        const labels = getLabels();
        for (const key of ALL_KEYS) {
          if (!(key in labels)) throw new Error(`Missing label key: ${key}`);
          if (!labels[key]) throw new Error(`Empty label value for key: ${key}`);
        }
      },
    },
    {
      name: "getLabels returns defaults when nothing is customized",
      fn() {
        resetAllLabels();
        const labels = getLabels();
        for (const key of ALL_KEYS) {
          if (labels[key] !== DEFAULT_LABELS[key]) {
            throw new Error(`Label "${key}": expected "${DEFAULT_LABELS[key]}" got "${labels[key]}"`);
          }
        }
      },
    },
    {
      name: "setLabel persists custom value",
      fn() {
        const key = ALL_KEYS[0]!;
        const original = DEFAULT_LABELS[key];
        setLabel(key, "CUSTOM_TEST_VALUE");
        const labels = getLabels();
        expect(labels[key]).toBe("CUSTOM_TEST_VALUE");
        // cleanup
        resetLabel(key);
        expect(getLabels()[key]).toBe(original);
      },
    },
    {
      name: "resetAllLabels restores all defaults",
      fn() {
        // Set a few custom values
        setLabel(ALL_KEYS[0]!, "X");
        setLabel(ALL_KEYS[1]!, "Y");
        resetAllLabels();
        const labels = getLabels();
        for (const key of ALL_KEYS) {
          if (labels[key] !== DEFAULT_LABELS[key]) {
            throw new Error(`After resetAll, label "${key}" was not restored`);
          }
        }
      },
    },
    {
      name: "no DEFAULT_LABELS value is empty or whitespace-only",
      fn() {
        for (const [key, val] of Object.entries(DEFAULT_LABELS)) {
          if (!val || !val.trim()) {
            throw new Error(`Empty default for key: ${key}`);
          }
        }
      },
    },
    {
      name: "no DEFAULT_LABELS key contains placeholder {{text}}",
      fn() {
        for (const [key, val] of Object.entries(DEFAULT_LABELS)) {
          if (/\{\{/.test(val)) {
            throw new Error(`Unfilled placeholder in key "${key}": ${val}`);
          }
        }
      },
    },
  ],
};

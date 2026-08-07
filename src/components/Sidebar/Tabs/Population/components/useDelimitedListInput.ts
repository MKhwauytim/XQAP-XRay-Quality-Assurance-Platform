import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";

import { parseMappingAliases } from "./mappingSettingsConfig";

function arraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

/**
 * Backs a comma-delimited text input (alias lists, sheet-name patterns, stage aliases, ...)
 * whose canonical value is a `string[]`.
 *
 * The bug this exists to fix: a naive controlled input derives `value` straight from
 * `parsedArray.join(", ")`. The instant a user types a trailing comma, parsing the raw text
 * (`split(",").filter(Boolean)`) drops the empty trailing token, so the very next render
 * rejoins the array back to its pre-comma string — the comma is erased before it can ever be
 * followed by a second alias. Typing more than one alias is then structurally impossible.
 *
 * The fix: keep the text the user is actively typing in local state (`rawText`), and only
 * parse it into the canonical array on commit (blur / Enter) — never on every keystroke, and
 * never round-tripped back through parse->join into the value being typed into.
 *
 * `rawText` still re-syncs from `value` when the upstream canonical array changes for a reason
 * other than this hook's own last commit (e.g. an external "reset to defaults" action, or
 * switching which record is being edited) — tracked via `lastCommittedRef` so a normal
 * commit round-trip (local edit -> onCommit -> parent re-renders with the same parsed array)
 * does not clobber whatever the user is mid-typing.
 */
export function useDelimitedListInput(
  value: string[],
  onCommit: (values: string[]) => void,
  parse: (raw: string) => string[] = parseMappingAliases,
  join: (values: string[]) => string = (values) => values.join(", "),
) {
  const [rawText, setRawText] = useState(() => join(value));
  const lastCommittedRef = useRef<string[]>(value);

  useEffect(() => {
    if (!arraysEqual(value, lastCommittedRef.current)) {
      lastCommittedRef.current = value;
      // Re-sync the typed text only when the upstream value changed for a reason other than this
      // hook's own last commit (e.g. an external "restore defaults"), so in-progress typing is
      // never clobbered by a parent re-render.
      setRawText(join(value));
    }
  }, [value, join]);

  const commit = () => {
    const parsed = parse(rawText);
    lastCommittedRef.current = parsed;
    onCommit(parsed);
  };

  return {
    value: rawText,
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setRawText(event.target.value),
    onBlur: commit,
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        commit();
      }
    },
  };
}

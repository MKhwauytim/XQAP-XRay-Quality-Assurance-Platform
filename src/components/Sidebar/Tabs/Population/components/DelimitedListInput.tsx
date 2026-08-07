import type { CSSProperties } from "react";

import { useDelimitedListInput } from "./useDelimitedListInput";

type DelimitedListInputProps = {
  value: string[];
  onCommit: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};

/**
 * Comma-delimited alias/pattern text input. Wraps `useDelimitedListInput` in its own component
 * instance (one per list being edited) so each field's typed-but-uncommitted text is isolated —
 * calling the hook directly inside a `.map()` render loop would violate the rules of hooks
 * whenever the number of rows can change (adding/removing a custom field, a workflow step, ...).
 *
 * Parses to the canonical `string[]` only on blur or Enter — never on every keystroke — so a
 * trailing comma (or any other in-progress delimiter) survives while the user is still typing.
 */
export function DelimitedListInput({
  value,
  onCommit,
  placeholder,
  className,
  style,
  ...rest
}: DelimitedListInputProps) {
  const field = useDelimitedListInput(value, onCommit);
  return (
    <input
      type="text"
      className={className}
      placeholder={placeholder}
      style={style}
      value={field.value}
      onChange={field.onChange}
      onBlur={field.onBlur}
      onKeyDown={field.onKeyDown}
      aria-label={rest["aria-label"]}
    />
  );
}

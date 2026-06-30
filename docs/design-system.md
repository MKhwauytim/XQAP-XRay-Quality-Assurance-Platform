# Design System — Refined Cohesion

Single source of truth for the X-Ray QC app's visual language. Tokens live in
`src/index.css`; shared component primitives live in `src/styles/primitives.css`.

**Rule:** build UI from tokens and primitives. Do not hardcode new hex colors or
re-roll local button/card/stat CSS — extend a token or a primitive instead.

## Tokens (`src/index.css :root`)

- **Palette:** `--brand-*`, `--c-navy*`, `--c-sky*`, `--c-ink*`, `--c-surface*`, `--c-border*`
- **Semantic:** `--c-success*`, `--c-warning*`, `--c-danger*`, `--c-info*`
- **Spacing (4px base):** `--sp-1 … --sp-12`
- **Radii:** `--r-xs … --r-2xl`
- **Elevation:** `--sh-xs` (resting card) → `--sh-sm` (raised) → `--sh-md/--lg` (overlay) → `--sh-xl` (modal)
- **Motion:** `--t-fast/base/slow/spring` with `--ease-spring/out/smooth`
- **Signature:** `--focus-ring`, `--accent-gradient`, `--sky-gradient`, `--premium-hairline`

## Primitives (`src/styles/primitives.css`)

| Class | Use | Modifiers |
|---|---|---|
| `.ui-btn` | buttons | `--primary` `--secondary` `--ghost` `--danger`, `--sm` `--lg`; `.ui-btn__icon` |
| `.ui-card` / `.ui-panel` | surfaces | `--interactive` `--raised`; `.ui-card__header` `.ui-card__title` |
| `.ui-stat` | KPI cards | `--premium` `--success` `--danger`; `__label` `__value` `__delta` |
| `.ui-badge` | status pills | `--neutral` `--info` `--success` `--warning` `--danger` |
| `.ui-field` | form fields | `__label` `__control` `__hint` `__error`; `--invalid` |
| `.ui-section` | section headers | `__eyebrow` `__title` `__actions` |
| `.ui-toolbar` | filter/action rows | `__group` |

React wrappers: `src/components/ui/Button.tsx`, `src/components/ui/StatCard.tsx`.

## Conventions

- **RTL-safe:** use logical properties (`margin-inline`, `inset-inline-start`, `border-start-*`).
- **Arabic UI strings** only (or label keys); code identifiers stay English.
- Honor `prefers-reduced-motion` (handled globally in `index.css`).
- Component classes always win over the gentle base form styling in `index.css`.

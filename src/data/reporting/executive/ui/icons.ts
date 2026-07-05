// Stroke-based inline-SVG line icons for the executive report.
// Pure functions returning SVG strings — no React, no DOM, no runtime JS, no emoji.
// Conventions: viewBox="0 0 24 24", stroke="currentColor", fill="none", so each
// icon inherits the surrounding text color (gold/level palette). Size is
// configurable; defaults to 24. Replaces every emoji glyph in the report.

const DEFAULT_SIZE = 24;

/** Inner SVG path/shape markup keyed by icon name. All use currentColor strokes. */
const PATHS: Record<string, string> = {
  // Security shield
  shield:
    '<path d="M12 3l7 3v5c0 4.2-2.9 7.4-7 8.5C7.9 18.4 5 15.2 5 11V6l7-3z"/>',
  // Port / gate — two pillars and a lintel
  port:
    '<path d="M5 21V8l7-4 7 4v13"/><path d="M5 21h14"/><path d="M9 21v-6h6v6"/>',
  // Scan — corner brackets + center line (x-ray scan)
  scan:
    '<path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  // Gauge — dial with needle
  gauge:
    '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/><circle cx="12" cy="18" r="1.2"/>',
  // Flag
  flag:
    '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  // Alert — triangle with bang
  alert:
    '<path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/>',
  // Check — checkmark in a ring
  check:
    '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  // Layers — stacked sheets
  layers:
    '<path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/>',
  // Users — two people
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M4 20c0-2.8 2.2-5 5-5s5 2.2 5 5"/><path d="M16 4.5a3 3 0 0 1 0 6.5"/><path d="M15 15.2c2.3.4 4 2.4 4 4.8"/>',
  // Document — page with text lines
  document:
    '<path d="M7 3h7l4 4v14H7V3z"/><path d="M14 3v4h4"/><path d="M9.5 13h5"/><path d="M9.5 16.5h5"/>',
  // Chart — axes + bars
  chart:
    '<path d="M5 4v15a1 1 0 0 0 1 1h14"/><path d="M9 16v-4"/><path d="M13 16V8"/><path d="M17 16v-6"/>',
  // Arrow — leftward (RTL forward direction)
  arrow:
    '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  // Truck — land ports
  truck:
    '<path d="M2 16V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8"/><path d="M14 11h4l3 3v2h-2.2"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="16.8" cy="17.5" r="1.7"/><path d="M8.7 17.5h6.4"/><path d="M2 16h3.3"/>',
  // Ship — sea ports
  ship:
    '<path d="M4 15l1.6 4.5h12.8L20 15l-8-2.6L4 15z"/><path d="M12 12.4V4"/><path d="M12 4l5.5 6.5H12"/>',
  // Sun — dark/light toggle
  sun:
    '<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2.2"/><path d="M12 18.8V21"/><path d="M4.2 12H6.4"/><path d="M17.6 12h2.2"/><path d="M6.3 6.3l1.5 1.5"/><path d="M16.2 16.2l1.5 1.5"/><path d="M17.7 6.3l-1.5 1.5"/><path d="M7.8 16.2l-1.5 1.5"/>',
  // Moon (crescent) — dark/light toggle
  moon:
    '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
};

/** All registered icon names. */
export const ICON_NAMES: string[] = Object.keys(PATHS);
export type IconName = (typeof ICON_NAMES)[number];

/** Neutral fallback rendered for an unknown icon name (a hollow circle). */
const FALLBACK = '<circle cx="12" cy="12" r="8.5"/>';

/**
 * Render an icon by name as an inline SVG string. Inherits `currentColor`.
 * Unknown names render a neutral fallback (never throws, never emits emoji).
 */
export function icon(name: string, size: number = DEFAULT_SIZE): string {
  const inner = PATHS[name] ?? FALLBACK;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ` +
    `role="img" aria-hidden="true">${inner}</svg>`
  );
}

// Named convenience exports — one per registered icon.
export const shield = (size?: number): string => icon("shield", size);
export const port = (size?: number): string => icon("port", size);
export const scan = (size?: number): string => icon("scan", size);
export const gauge = (size?: number): string => icon("gauge", size);
export const flag = (size?: number): string => icon("flag", size);
export const alert = (size?: number): string => icon("alert", size);
export const check = (size?: number): string => icon("check", size);
export const layers = (size?: number): string => icon("layers", size);
export const users = (size?: number): string => icon("users", size);
export const document = (size?: number): string => icon("document", size);
export const chart = (size?: number): string => icon("chart", size);
export const arrow = (size?: number): string => icon("arrow", size);
export const truck = (size?: number): string => icon("truck", size);
export const ship = (size?: number): string => icon("ship", size);
export const sun = (size?: number): string => icon("sun", size);
export const moon = (size?: number): string => icon("moon", size);

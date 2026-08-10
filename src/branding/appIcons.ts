import shieldRaw from "./zatca-shield.svg?raw";
import shieldCompactRaw from "./zatca-shield-compact.svg?raw";

const BRAND_NAVY = "#17365d";

/**
 * The shield artwork's own viewBox is 512x512, but its silhouette only
 * occupies this sub-rectangle (see the `M96 64 L416 64 ...` path in
 * zatca-shield.svg / zatca-shield-compact.svg). Framing the nested <svg>'s
 * viewBox to exactly this box means `preserveAspectRatio="xMidYMid meet"`
 * scales and centers the shield itself, not its surrounding empty space.
 */
const SHIELD_BOUNDS = { x: 96, y: 64, width: 320, height: 416 };

/**
 * Strips the outer `<svg ...>` / `</svg>` wrapper from a raw SVG source,
 * leaving only its inner markup (defs + drawing) so it can be re-embedded
 * inside a nested `<svg>` element without a doubled root tag.
 */
function innerMarkup(rawSvg: string): string {
  return rawSvg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

/**
 * Composes a shield mark onto a solid navy square tile, with `paddingRatio`
 * of empty margin on every side (e.g. 0.12 = 12% padding per edge). Returns
 * a self-contained `data:image/svg+xml` URI — see organization.ts for the
 * same encoding precedent (VIS-05: bundled locally, never network-dependent).
 */
function composeIconUri(rawSvg: string, paddingRatio: number, size = 512): string {
  const pad = size * paddingRatio;
  const contentSize = size - pad * 2;
  const { x, y, width, height } = SHIELD_BOUNDS;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BRAND_NAVY}" />
  <svg x="${pad}" y="${pad}" width="${contentSize}" height="${contentSize}" viewBox="${x} ${y} ${width} ${height}" preserveAspectRatio="xMidYMid meet">
    ${innerMarkup(rawSvg)}
  </svg>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * App icons, composed from the procedural shield marks in zatca-shield.svg
 * and zatca-shield-compact.svg (SVG source, ?raw-imported — see
 * organization.ts for the same pattern).
 *
 * These are declared with concrete square `sizes` (`"192x192"` / `"512x512"`)
 * and `type: "image/svg+xml"` in appManifest.ts rather than rasterized to PNG
 * at fixed pixel sizes:
 *   - No rasterizer dependency: package.json stays untouched and `npm ci`
 *     keeps working offline (see vendor/README.md for why that matters here).
 *   - Bundle budget: the build has ~243 kB of raw headroom against a 3.6 MB
 *     ceiling (npm run check:bundle-size). Three base64 PNGs would eat a
 *     real share of that; an inline SVG costs well under 1 kB.
 *   - One vector source scales cleanly to every size an OS asks for,
 *     without the per-size stroke-width tuning a rasterized set would need.
 *
 * If a target ever proves to reject SVG manifest icons, that must be
 * reported and fixed deliberately — not silently patched over by falling
 * back to an untested format here.
 */
export const APP_ICONS = {
  /** Full shield on navy, 12% padding, composed at its own 192x192 intrinsic size so the declared and decoded sizes agree. */
  icon192: composeIconUri(shieldRaw, 0.12, 192),
  icon512: composeIconUri(shieldRaw, 0.12),
  /** 20% padding keeps all shield content inside the ~80% "safe zone" circle that OS icon masks crop to. */
  icon512Maskable: composeIconUri(shieldRaw, 0.2),
  /**
   * Compact (fewer, thicker stripes) variant, tight padding, for the
   * browser-tab favicon where the full-detail mark would smudge.
   *
   * Has one manual downstream consumer: the `<link rel="icon">` literal in
   * index.html, which cannot import this TS module and hand-mirrors this
   * exact output instead. If this composition ever changes (artwork,
   * padding, or size), regenerate that literal too — see the sync comment
   * above the `<link>` tag in index.html for the other half of this note.
   */
  faviconSvg: composeIconUri(shieldCompactRaw, 0.08, 96),
} as const;

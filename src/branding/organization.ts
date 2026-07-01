import zatcaLogoRaw from "./zatca-logo.svg?raw";

export const ORGANIZATION_PATH = [
  "الشؤون القانونية والالتزام",
  "الإدارة العامة لضمان الجودة والامتثال",
  "إدارة الرقابة والامتثال على المنافذ",
] as const;

export const ORGANIZATION_PATH_TEXT = ORGANIZATION_PATH.join(" ← ");

/**
 * Official ZATCA identity mark (same mark used on the sign-in screen and the
 * executive report). The SVG ships dark/teal; recolour per surface with the
 * `--logo-filter*` CSS tokens (e.g. white on the dark navy nav/header).
 *
 * Bundled locally as a data URI (VIS-05): the app and its generated reports are
 * self-contained offline artifacts, so the mark must never depend on network.
 */
export const ZATCA_LOGO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(zatcaLogoRaw)}`;

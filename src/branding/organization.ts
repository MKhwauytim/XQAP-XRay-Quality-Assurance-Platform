export const ORGANIZATION_PATH = [
  "الشؤون القانونية والالتزام",
  "الإدارة العامة لضمان الجودة والامتثال",
  "إدارة الرقابة والامتثال على المنافذ",
] as const;

export const ORGANIZATION_PATH_TEXT = ORGANIZATION_PATH.join(" ← ");

/**
 * Official ZATCA identity mark (same source used on the sign-in screen and the
 * executive report). The SVG ships dark/teal; recolour per surface with the
 * `--logo-filter*` CSS tokens (e.g. white on the dark navy nav/header).
 */
export const ZATCA_LOGO_URL =
  "https://zatca.gov.sa/_layouts/15/zatca/Design/images/ZATCA-logo.svg";

// Single source for the Somar Sans brand font's 4 weights, so the live app
// and every generated report/deck HTML embed the SAME base64 payload once
// instead of two independent copies (§Q — was ~239.7KB duplicated, ~7.3% of
// the built bundle). Each consumer keeps its own font-family name and
// font-display value (the app uses "Somar Sans"/swap; reports use "Somar"/
// block, since report HTML is a standalone file with no network fetch to
// avoid blocking on) -- only the woff data URIs are shared here.
import somarLight from "../assets/fonts/SomarSans-Light.woff?inline";
import somarRegular from "../assets/fonts/SomarSans-Regular.woff?inline";
import somarMedium from "../assets/fonts/SomarSans-Medium.woff?inline";
import somarBold from "../assets/fonts/SomarSans-Bold.woff?inline";

export const SOMAR_SANS_WOFF = {
  light: somarLight,
  regular: somarRegular,
  medium: somarMedium,
  bold: somarBold,
} as const;

/**
 * Live-app @font-face block: family "Somar Sans", font-display: swap.
 * Matches the weight/style/order of the @font-face rules this replaces in
 * index.css exactly (Light 300, Regular 400, Medium 500, Bold 700).
 */
export const SOMAR_SANS_APP_FONT_FACE_CSS =
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.light}) format("woff");font-weight:300;font-style:normal;font-display:swap;}` +
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.regular}) format("woff");font-weight:400;font-style:normal;font-display:swap;}` +
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.medium}) format("woff");font-weight:500;font-style:normal;font-display:swap;}` +
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.bold}) format("woff");font-weight:700;font-style:normal;font-display:swap;}`;

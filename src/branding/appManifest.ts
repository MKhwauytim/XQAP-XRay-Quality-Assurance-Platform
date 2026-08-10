import { getLabels } from "../data/labels/labelsStore";
import { APP_ICONS } from "./appIcons.generated";

export type AppManifestIcon = {
  src: string;
  sizes: string;
  type: "image/png";
  purpose: "any" | "maskable";
};

export type AppManifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  dir: "rtl";
  lang: "ar";
  theme_color: string;
  background_color: string;
  icons: AppManifestIcon[];
};

const BRAND_NAVY = "#17365d";

const DESCRIPTION =
  "تطبيق محلي لمعالجة بيانات جودة الأشعة وتجهيز مجتمع العينة من ملفات Excel — الهيئة العامة للزكاة والضريبة والجمارك.";

/**
 * `scope` is the directory containing the document. A trailing-file scope would
 * exclude the app from its own navigations.
 */
function scopeFrom(href: string): string {
  const lastSlash = href.lastIndexOf("/");
  return lastSlash === -1 ? href : href.slice(0, lastSlash + 1);
}

export function buildAppManifest(location: { href: string }): AppManifest {
  return {
    id: "xqap",
    name: getLabels().app_display_name,
    short_name: "XQAP",
    description: DESCRIPTION,
    start_url: location.href,
    scope: scopeFrom(location.href),
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    theme_color: BRAND_NAVY,
    background_color: BRAND_NAVY,
    icons: [
      { src: APP_ICONS.icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: APP_ICONS.icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: APP_ICONS.icon512Maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * Registers the manifest as a blob: URL.
 *
 * A data: URI cannot be used: `start_url` and `scope` resolve relative to the
 * manifest's own URL, and a data: URI has no origin, so Chrome rejects the
 * install. A blob: URL inherits the document origin, so start_url resolves
 * same-origin. This keeps dist/ a single index.html either way.
 *
 * On a file:// origin the browser ignores the manifest entirely — that is the
 * intended silent degradation, not an error.
 *
 * This is the ONLY function that knows how the manifest reaches the browser.
 * If blob: manifests prove unreliable, replace this body and nothing else.
 */
export function registerAppManifest(): void {
  try {
    const manifest = buildAppManifest(window.location);
    const blob = new Blob([JSON.stringify(manifest)], {
      type: "application/manifest+json",
    });
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = URL.createObjectURL(blob);
    document.head.appendChild(link);
  } catch {
    // Manifest registration is cosmetic. Never block app start.
  }
}

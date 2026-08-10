import { getLabels } from "../data/labels/labelsStore";
import { APP_ICONS } from "./appIcons";

export type AppManifestIcon = {
  src: string;
  sizes: string;
  type: "image/svg+xml";
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

/**
 * `scope` is the directory containing the document (origin + pathname,
 * truncated at the last `/`), never the document itself and never the
 * query/fragment. A trailing-file scope would exclude the app from its own
 * navigations; leaking `search`/`hash` into scope would produce a bogus,
 * non-directory value. Parsed via `URL` rather than string-slicing the raw
 * href, since a naive `lastIndexOf("/")` over the whole href can land inside
 * a query string (`?next=/dashboard`) or drop the host entirely for a bare
 * origin with no path. Falls back to the raw href if it isn't a parseable
 * URL — `registerAppManifest` must never throw into app start.
 */
function scopeFrom(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  const path = url.pathname;
  const lastSlash = path.lastIndexOf("/");
  const directory = lastSlash === -1 ? "/" : path.slice(0, lastSlash + 1);
  return url.origin + directory;
}

export function buildAppManifest(location: { href: string }): AppManifest {
  return {
    id: "xqap",
    name: getLabels().app_display_name,
    short_name: "XQAP",
    description: getLabels().app_description,
    start_url: location.href,
    scope: scopeFrom(location.href),
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    theme_color: BRAND_NAVY,
    background_color: BRAND_NAVY,
    icons: [
      { src: APP_ICONS.icon192, sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: APP_ICONS.icon512, sizes: "512x512", type: "image/svg+xml", purpose: "any" },
      { src: APP_ICONS.icon512Maskable, sizes: "512x512", type: "image/svg+xml", purpose: "maskable" },
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

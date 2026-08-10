import { describe, it, expect } from "vitest";
import { buildAppManifest } from "./appManifest";
import { DEFAULT_LABELS } from "../data/labels/labelsStore";

describe("buildAppManifest", () => {
  const manifest = buildAppManifest({ href: "https://intranet.example/xqap/index.html" });

  it("uses the app display name and description from the label store", () => {
    expect(manifest.name).toBe(DEFAULT_LABELS.app_display_name);
    expect(manifest.short_name).toBe("XQAP");
    expect(manifest.description).toBe(DEFAULT_LABELS.app_description);
  });

  it("derives start_url and scope from the document location", () => {
    expect(manifest.start_url).toBe("https://intranet.example/xqap/index.html");
    expect(manifest.scope).toBe("https://intranet.example/xqap/");
  });

  it("truncates scope at the directory, ignoring a query string containing a slash", () => {
    const withQuery = buildAppManifest({
      href: "https://intranet.example/xqap/index.html?next=/dashboard",
    });
    expect(withQuery.scope).toBe("https://intranet.example/xqap/");
  });

  it("truncates scope at the directory, ignoring a fragment containing a slash", () => {
    const withHash = buildAppManifest({
      href: "https://intranet.example/xqap/index.html#/route",
    });
    expect(withHash.scope).toBe("https://intranet.example/xqap/");
  });

  it("derives scope from a bare origin with no path, preserving the host", () => {
    const bareOrigin = buildAppManifest({ href: "https://example.com" });
    expect(bareOrigin.scope).toBe("https://example.com/");
  });

  it("leaves a directory-style href (already ending in /) unchanged", () => {
    const directoryHref = buildAppManifest({ href: "https://intranet.example/xqap/" });
    expect(directoryHref.scope).toBe("https://intranet.example/xqap/");
  });

  it("declares a standalone RTL Arabic app in the ZATCA navy", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.dir).toBe("rtl");
    expect(manifest.lang).toBe("ar");
    expect(manifest.theme_color).toBe("#17365d");
    expect(manifest.background_color).toBe("#17365d");
    expect(manifest.id).toBe("xqap");
  });

  it("declares any-size and maskable icons as inline SVG data URIs", () => {
    const purposes = manifest.icons.map((icon) => icon.purpose);
    expect(purposes.filter((purpose) => purpose === "any")).toHaveLength(2);
    expect(purposes.filter((purpose) => purpose === "maskable")).toHaveLength(1);
    for (const icon of manifest.icons) {
      expect(icon.sizes).toBe("any");
      expect(icon.type).toBe("image/svg+xml");
      expect(icon.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    }
  });
});

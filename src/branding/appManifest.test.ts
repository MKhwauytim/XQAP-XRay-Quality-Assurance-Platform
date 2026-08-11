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

  it("declares concrete square sizes and maskable icons as inline PNG data URIs", () => {
    const purposes = manifest.icons.map((icon) => icon.purpose);
    expect(purposes.filter((purpose) => purpose === "any")).toHaveLength(2);
    expect(purposes.filter((purpose) => purpose === "maskable")).toHaveLength(1);
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(["192x192", "512x512", "512x512"]);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  it("declares every icon size as square (or 'any')", () => {
    for (const icon of manifest.icons) {
      if (icon.sizes === "any") continue;
      const match = /^(\d+)x(\d+)$/.exec(icon.sizes);
      expect(match).not.toBeNull();
      const [, w, h] = match!;
      expect(w).toBe(h);
    }
  });

  /**
   * Chrome's manifest icon pipeline does not accept SVG (verified via
   * DevTools -> Application -> Manifest on a properly served origin: every
   * SVG manifest icon was reported "failed to load"). The committed PNGs
   * must actually decode to their declared pixel size — not merely start
   * with the right MIME prefix, which is exactly the kind of check that let
   * a 1x1 placeholder PNG slip through previously. Read the real width and
   * height straight out of the PNG's IHDR chunk (bytes 16-19 = width,
   * 20-23 = height, big-endian) after base64-decoding.
   */
  it("decodes each committed PNG icon's real pixel dimensions to match its declared sizes", () => {
    for (const icon of manifest.icons) {
      const [, expectedSide] = /^(\d+)x\d+$/.exec(icon.sizes) ?? [];
      expect(expectedSide, `icon with sizes "${icon.sizes}" should be a concrete WxH`).toBeDefined();

      const base64 = icon.src.slice("data:image/png;base64,".length);
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      const width = view.getUint32(16, false);
      const height = view.getUint32(20, false);

      expect(width).toBe(Number(expectedSide));
      expect(height).toBe(Number(expectedSide));
    }
  });
});

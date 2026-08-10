import { describe, it, expect } from "vitest";
import { buildAppManifest } from "./appManifest";
import { DEFAULT_LABELS } from "../data/labels/labelsStore";

describe("buildAppManifest", () => {
  const manifest = buildAppManifest({ href: "https://intranet.example/xqap/index.html" });

  it("uses the app display name from the label store", () => {
    expect(manifest.name).toBe(DEFAULT_LABELS.app_display_name);
    expect(manifest.short_name).toBe("XQAP");
  });

  it("derives start_url and scope from the document location", () => {
    expect(manifest.start_url).toBe("https://intranet.example/xqap/index.html");
    expect(manifest.scope).toBe("https://intranet.example/xqap/");
  });

  it("declares a standalone RTL Arabic app in the ZATCA navy", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.dir).toBe("rtl");
    expect(manifest.lang).toBe("ar");
    expect(manifest.theme_color).toBe("#17365d");
    expect(manifest.background_color).toBe("#17365d");
    expect(manifest.id).toBe("xqap");
  });

  it("declares 192, 512 and maskable 512 icons as inline data URIs", () => {
    const sizes = manifest.icons.map((icon) => `${icon.sizes}:${icon.purpose}`);
    expect(sizes).toContain("192x192:any");
    expect(sizes).toContain("512x512:any");
    expect(sizes).toContain("512x512:maskable");
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("data:image/png;base64,")).toBe(true);
      expect(icon.type).toBe("image/png");
    }
  });
});

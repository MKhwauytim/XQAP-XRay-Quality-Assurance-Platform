/* @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { registerAppManifest } from "./appManifest";

describe("registerAppManifest", () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel="manifest"]').forEach((link) => link.remove());
    vi.restoreAllMocks();
  });

  it("appends a manifest link to <head> with a blob: href", () => {
    const objectUrl = "blob:https://intranet.example/fake-manifest-id";
    vi.spyOn(URL, "createObjectURL").mockReturnValue(objectUrl);

    registerAppManifest();

    const link = document.head.querySelector('link[rel="manifest"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe(objectUrl);
  });

  it("swallows a failure (e.g. createObjectURL throwing) instead of throwing", () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("createObjectURL unavailable");
    });

    expect(() => registerAppManifest()).not.toThrow();
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull();
  });
});

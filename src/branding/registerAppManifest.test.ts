/* @vitest-environment jsdom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { registerAppManifest } from "./appManifest";

const originMock = vi.hoisted(() => ({ isFile: false }));
vi.mock("../data/workspace/originDetection", () => ({
  isFileOrigin: () => originMock.isFile,
}));

describe("registerAppManifest", () => {
  afterEach(() => {
    document.head.querySelectorAll('link[rel="manifest"]').forEach((link) => link.remove());
    vi.restoreAllMocks();
    originMock.isFile = false;
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

  it("appends no manifest link on a file:// origin", () => {
    originMock.isFile = true;
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL");

    registerAppManifest();

    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it("still appends exactly one manifest link on a served origin", () => {
    originMock.isFile = false;
    const objectUrl = "blob:https://intranet.example/served-origin";
    vi.spyOn(URL, "createObjectURL").mockReturnValue(objectUrl);

    registerAppManifest();

    const links = document.head.querySelectorAll('link[rel="manifest"]');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(objectUrl);
  });
});

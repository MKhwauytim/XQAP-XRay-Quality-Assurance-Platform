// PoC helpers: Edge headless (measure Somar text, dump DOM checks, screenshots).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const FONT_DIR = (process.env.LOCALAPPDATA || "").replace(/\\/g, "/") + "/Microsoft/Windows/Fonts";
export const fontFaceCss = (family = "Somar") =>
  `@font-face{font-family:"${family}";src:url("${pathToFileURL(FONT_DIR + "/Somar-Regular.ttf").href}");font-weight:400;}` +
  `@font-face{font-family:"${family}";src:url("${pathToFileURL(FONT_DIR + "/Somar-Bold.ttf").href}");font-weight:700;}`;
export const SOMAR_TTF = { regular: FONT_DIR + "/Somar-Regular.ttf", bold: FONT_DIR + "/Somar-Bold.ttf" };

function profileDir(outDir) {
  const d = resolve(outDir, ".edge-profile");
  mkdirSync(d, { recursive: true });
  return d;
}

export function dumpDom(htmlFile, outDir) {
  return execFileSync(EDGE, [
    "--headless", "--disable-gpu", "--log-level=3", "--no-first-run", `--user-data-dir=${profileDir(outDir)}`,
    "--allow-file-access-from-files", "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(htmlFile).href,
  ], { encoding: "utf8", maxBuffer: 1e8 });
}

export function screenshot(htmlFile, pngFile, outDir, w = 1920, h = 1080) {
  execFileSync(EDGE, [
    "--headless", "--disable-gpu", "--log-level=3", "--no-first-run", `--user-data-dir=${profileDir(outDir)}`,
    "--allow-file-access-from-files", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--window-size=${w},${h}`, "--virtual-time-budget=10000", `--screenshot=${pngFile}`, pathToFileURL(htmlFile).href,
  ], { stdio: "ignore" });
}

// Measure advance widths of strings in Somar with canvas measureText (the browser's own shaper).
// Returns width in px per 1px of font size, so width(size) = k * size.
export function measure(items, outDir) {
  const file = join(outDir, "measure.html");
  writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss()}</style></head><body><pre id="out">PENDING</pre>
<script>
const items = ${JSON.stringify(items)};
(async () => {
  await document.fonts.load('400 100px Somar'); await document.fonts.load('700 100px Somar');
  const c = document.createElement('canvas').getContext('2d');
  c.direction = 'rtl';
  const res = items.map(i => { c.font = (i.w || 400) + ' 100px Somar'; return c.measureText(i.t).width / 100; });
  document.getElementById('out').textContent = 'RESULT' + JSON.stringify({ fontOk: document.fonts.check('400 100px Somar'), res }) + 'END';
})();
</script></body></html>`);
  const dom = dumpDom(file, outDir);
  const m = /<pre id="out">RESULT(.*?)END<\/pre>/s.exec(dom);
  if (!m) throw new Error("measure: no result from Edge");
  const r = JSON.parse(m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  if (!r.fontOk) throw new Error("measure: Somar did not load in Edge");
  return r.res;
}

// Runs buildPitch.ts through Vite's SSR loader (no tsx / vite-node in node_modules).
// The repo's vite.config.ts supplies __APP_VERSION__ and the import handling.
// Usage: node poc/pitch/run.mjs            (deck only)
//        node poc/pitch/run.mjs --shots DIR (also one HTML per slide for screenshots)
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mem = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
process.env.PITCH_ROOT = root;
const i = process.argv.indexOf("--shots");
if (i > 0) process.env.PITCH_SHOTS_DIR = path.resolve(process.argv[i + 1]);

const server = await createServer({ root, configFile: path.join(root, "vite.config.ts"), server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error" });
try {
  const mod = await server.ssrLoadModule("/poc/pitch/buildPitch.ts");
  await mod.main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await server.close();
}

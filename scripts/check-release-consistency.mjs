import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const editLog = await readFile(new URL("docs/EDIT_LOG.md", root), "utf8");
const latestHeading = editLog.match(/^## v([^\s]+)/m)?.[1];
const releaseLine = `${packageJson.version}`.split(".").slice(0, 2).join(".");

if (!latestHeading) {
  throw new Error("EDIT_LOG.md has no version heading.");
}

if (latestHeading !== releaseLine) {
  throw new Error(
    `Release version mismatch: package.json=${packageJson.version}, latest EDIT_LOG=v${latestHeading}.`,
  );
}

console.log(`Release metadata is consistent at v${packageJson.version}.`);

import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const editLogDirectory = new URL("docs/edit%20logs/", root);
const dailyFiles = (await readdir(editLogDirectory))
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
  .sort((a, b) => b.localeCompare(a));
const editLog = (
  await Promise.all(dailyFiles.map((name) => readFile(new URL(name, editLogDirectory), "utf8")))
).join("\n");
const latestHeading = editLog.match(/^## v([^\s]+)/m)?.[1];
const releaseLine = `${packageJson.version}`.split(".").slice(0, 2).join(".");

if (!latestHeading) {
  throw new Error("The daily edit logs have no version heading.");
}

if (latestHeading !== releaseLine) {
  throw new Error(
    `Release version mismatch: package.json=${packageJson.version}, latest daily edit log=v${latestHeading}.`,
  );
}

console.log(`Release metadata is consistent at v${packageJson.version}.`);

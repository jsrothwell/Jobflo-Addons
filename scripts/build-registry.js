#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const addonsDir = path.join(rootDir, "addons");
const outDir = path.join(rootDir, "docs");
const outFile = path.join(outDir, "registry.json");

function readManifests() {
  if (!fs.existsSync(addonsDir)) {
    return [];
  }

  const entries = fs
    .readdirSync(addonsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const manifests = [];

  for (const entry of entries) {
    const manifestPath = path.join(addonsDir, entry.name, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(raw);
      manifests.push(manifest);
    } catch (error) {
      console.error(`Failed to parse ${manifestPath}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  return manifests;
}

function main() {
  const manifests = readManifests();

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(manifests, null, 2)}\n`);

  console.log(`Wrote ${manifests.length} addon(s) to ${path.relative(rootDir, outFile)}`);
}

main();

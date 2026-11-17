#!/usr/bin/env node
/**
 * Syncs `src/core/` into `plugin/server/core/` so `plugin/` stays completely
 * self-contained for Paseo's isolated git plugin checkout loader.
 *
 * Pass `--check` to verify `plugin/server/core/` matches `src/core/` without writing.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const srcCoreDir = path.join(repoRoot, 'src', 'core');
const pluginCoreDir = path.join(repoRoot, 'plugin', 'server', 'core');
const checkOnly = process.argv.includes('--check');

function listTsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const srcFiles = listTsFiles(srcCoreDir);
const destFiles = listTsFiles(pluginCoreDir);
const drifts = [];

for (const file of srcFiles) {
  const srcBuf = readFileSync(path.join(srcCoreDir, file));
  const destPath = path.join(pluginCoreDir, file);
  if (!existsSync(destPath)) {
    drifts.push(`missing in plugin/server/core/: ${file}`);
  } else if (sha256(srcBuf) !== sha256(readFileSync(destPath))) {
    drifts.push(`out of sync: ${file}`);
  }
}

for (const file of destFiles) {
  if (!srcFiles.includes(file)) {
    drifts.push(`extra file in plugin/server/core/: ${file}`);
  }
}

if (checkOnly) {
  if (drifts.length > 0) {
    console.error('plugin/server/core drift detected:\n' + drifts.map((d) => `  - ${d}`).join('\n'));
    console.error('Run `npm run sync:plugin-core` to synchronize.');
    process.exit(1);
  }
  console.log(`plugin/server/core matches src/core (${srcFiles.length} files)`);
  process.exit(0);
}

mkdirSync(pluginCoreDir, { recursive: true });
for (const file of destFiles) {
  if (!srcFiles.includes(file)) {
    rmSync(path.join(pluginCoreDir, file));
  }
}
for (const file of srcFiles) {
  const srcBuf = readFileSync(path.join(srcCoreDir, file));
  writeFileSync(path.join(pluginCoreDir, file), srcBuf);
}
console.log(`Synced ${srcFiles.length} files from src/core to plugin/server/core`);

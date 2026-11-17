#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { styleText } from 'node:util';

const rootDir = path.resolve(import.meta.dirname, '..');

const TIERS = [
  {
    id: 'tier1',
    name: 'Tier 1: Feature Coverage',
    dir: 'test/e2e/tier1-features',
    description: 'Isolated requirement coverage across core, CLI & plugin features',
  },
  {
    id: 'tier2',
    name: 'Tier 2: Boundary & Corner Cases',
    dir: 'test/e2e/tier2-boundaries',
    description: 'Empty states, malformed payloads, API errors, and CLI flags',
  },
  {
    id: 'tier3',
    name: 'Tier 3: Cross-Feature Combinations',
    dir: 'test/e2e/tier3-combinations',
    description: 'Pairwise integration: Keychain, fallback sync, quota flow & plugin',
  },
  {
    id: 'tier4',
    name: 'Tier 4: Real-World Application Scenarios',
    dir: 'test/e2e/tier4-scenarios',
    description: 'Multi-step end-to-end workflows matching developer usage',
  },
];

async function runTestFile(filePath) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const child = spawn(process.execPath, ['--test', filePath], {
      cwd: rootDir,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      const duration = Date.now() - startTime;

      // Extract test stats from node --test output:
      // "ℹ tests 5"
      // "ℹ pass 5"
      // "ℹ fail 0"
      const testsMatch = stdout.match(/ℹ tests (\d+)/);
      const passMatch = stdout.match(/ℹ pass (\d+)/);
      const failMatch = stdout.match(/ℹ fail (\d+)/);

      const tests = testsMatch ? parseInt(testsMatch[1], 10) : 0;
      const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
      const fail = failMatch ? parseInt(failMatch[1], 10) : code !== 0 ? 1 : 0;

      resolve({
        file: filePath,
        baseName: path.basename(filePath),
        code,
        duration,
        tests,
        pass,
        fail,
        stdout,
        stderr,
      });
    });
  });
}

async function main() {
  console.log(styleText('bold', '\n========================================================================'));
  console.log(styleText(['bold', 'cyan'], '   agy-switcher — Comprehensive 4-Tier E2E Test Suite'));
  console.log(styleText('bold', '========================================================================\n'));

  const overallStart = Date.now();
  let totalTests = 0;
  let totalPass = 0;
  let totalFail = 0;
  let allFilesPassed = true;

  const tierResults = [];

  for (const tier of TIERS) {
    const tierDir = path.join(rootDir, tier.dir);
    if (!fs.existsSync(tierDir)) {
      console.log(styleText('yellow', `[WARN] Directory not found: ${tier.dir}`));
      continue;
    }

    const testFiles = fs
      .readdirSync(tierDir)
      .filter((f) => f.endsWith('.test.ts') || f.endsWith('.test.js'))
      .sort();

    console.log(styleText(['bold', 'blue'], `▶ [${tier.id.toUpperCase()}] ${tier.name}`));
    console.log(styleText('dim', `  ${tier.description} (${testFiles.length} files)\n`));

    const fileResults = [];

    for (const file of testFiles) {
      const relPath = path.join(tier.dir, file);
      process.stdout.write(`  ⏳ ${file}... `);
      const res = await runTestFile(relPath);
      fileResults.push(res);

      totalTests += res.tests;
      totalPass += res.pass;
      totalFail += res.fail;

      if (res.code === 0 && res.fail === 0) {
        console.log(
          styleText('green', `✔ PASS`) +
            styleText('dim', ` (${res.tests} tests, ${res.duration}ms)`)
        );
      } else {
        allFilesPassed = false;
        console.log(
          styleText('red', `✖ FAIL`) +
            styleText('dim', ` (${res.fail} failed, exit ${res.code}, ${res.duration}ms)`)
        );
        if (res.stderr) {
          console.log(styleText('red', `\n--- STDERR for ${file} ---`));
          console.log(res.stderr.trim());
          console.log(styleText('red', '---------------------------\n'));
        }
      }
    }

    tierResults.push({
      tier,
      files: fileResults,
      tests: fileResults.reduce((acc, r) => acc + r.tests, 0),
      pass: fileResults.reduce((acc, r) => acc + r.pass, 0),
      fail: fileResults.reduce((acc, r) => acc + r.fail, 0),
      duration: fileResults.reduce((acc, r) => acc + r.duration, 0),
    });

    console.log();
  }

  const overallDuration = Date.now() - overallStart;

  // Print Summary Table
  console.log(styleText('bold', '------------------------------------------------------------------------'));
  console.log(styleText(['bold', 'white'], '               4-TIER E2E TEST SUMMARY MATRIX'));
  console.log(styleText('bold', '------------------------------------------------------------------------'));
  console.log(
    'TIER                           FILES    TESTS    PASS    FAIL    TIME      STATUS'
  );
  console.log('------------------------------------------------------------------------');

  for (const tr of tierResults) {
    const status = tr.fail === 0 ? styleText('green', 'PASS') : styleText('red', 'FAIL');
    const tierName = tr.tier.name.padEnd(30);
    const files = String(tr.files.length).padStart(5);
    const tests = String(tr.tests).padStart(8);
    const pass = styleText('green', String(tr.pass).padStart(7));
    const fail = tr.fail > 0 ? styleText('red', String(tr.fail).padStart(7)) : String(0).padStart(7);
    const time = `${tr.duration}ms`.padStart(9);

    console.log(`${tierName} ${files} ${tests} ${pass} ${fail} ${time}      ${status}`);
  }

  console.log(styleText('bold', '------------------------------------------------------------------------'));
  const grandStatus = allFilesPassed && totalFail === 0 ? styleText(['bold', 'green'], 'SUCCESS (100% PASS)') : styleText(['bold', 'red'], 'FAILED');
  console.log(
    `TOTAL                          ${String(
      tierResults.reduce((acc, t) => acc + t.files.length, 0)
    ).padStart(5)} ${String(totalTests).padStart(8)} ${styleText('green', String(totalPass).padStart(7))} ${
      totalFail > 0 ? styleText('red', String(totalFail).padStart(7)) : String(0).padStart(7)
    } ${(overallDuration + 'ms').padStart(9)}      ${grandStatus}`
  );
  console.log(styleText('bold', '========================================================================\n'));

  if (!allFilesPassed || totalFail > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});

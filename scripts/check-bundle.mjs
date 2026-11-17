#!/usr/bin/env node
/**
 * Paseo Hermes + CJS bundle verification for `plugin/`.
 * Mirrors Paseo's plugin compiler rules over git-tracked files (or working files when `--working` is set):
 * - placement boundary (client/ vs server/ vs shared/)
 * - no external npm packages outside Paseo SDK / React / React Native / Zod
 * - no class syntax or browser DOM APIs in the Hermes client bundle
 * - CJS VM evaluation check for the server bundle
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const CLIENT_SDK = ['@getpaseo/plugin/client', '@getpaseo/plugin/client/ui', '@getpaseo/plugin/client/react-native'];
const SERVER_SDK = ['@getpaseo/plugin/server', '@getpaseo/plugin/server/provider', '@getpaseo/plugin/server/usage', '@getpaseo/plugin/server/acp'];
const SDK = ['@getpaseo/plugin', ...SERVER_SDK, ...CLIENT_SDK];
const CLIENT_ONLY = /^((?:@types\/)?react(?:-dom|-native)?|use-sync-external-store|@tanstack\/react-query)(\/|$)/;
const IMPORTS = /\b(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const HOST = /^(zod|react|react-native|@tanstack\/react-query)(\/|$)/;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginRoot = path.join(repoRoot, 'plugin');
const useWorkingTree = process.argv.includes('--working');

function walkFiles(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

function copyPluginTree(source) {
  const copy = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'agy-bundle-')));
  let files;
  if (useWorkingTree) {
    files = walkFiles(source);
  } else {
    const env = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
      delete env[key];
    }
    const tracked = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: source, env })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    files = tracked.length > 0 ? tracked : walkFiles(source);
  }
  for (const file of files) {
    const srcPath = path.join(source, file);
    if (!existsSync(srcPath)) continue;
    mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
    if (lstatSync(srcPath).isSymbolicLink()) {
      symlinkSync(readlinkSync(srcPath), path.join(copy, file));
    } else {
      copyFileSync(srcPath, path.join(copy, file));
    }
  }
  return copy;
}

const root = copyPluginTree(realpathSync.native(pluginRoot));

function placeOf(file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return 'outside';
  const [first] = relative.split(path.sep);
  if (first === 'node_modules') return null;
  if (first === 'client' || first === 'server' || first === 'shared') return first;
  if (/^index\.client\.tsx?$/.test(relative)) return 'client';
  if (/^index\.server\.tsx?$/.test(relative)) return 'server';
  return 'invalid';
}

function installError(specifier, importer, typeOnly) {
  if (
    specifier.startsWith('.') ||
    path.isAbsolute(specifier) ||
    SDK.includes(specifier) ||
    HOST.test(specifier) ||
    isBuiltin(specifier) ||
    specifier === '@types/node'
  ) {
    return null;
  }
  try {
    createRequire(importer).resolve(specifier);
    return null;
  } catch {
    return typeOnly
      ? `Could not resolve type dependency "${specifier}" imported by ${importer}`
      : `Could not resolve "${specifier}" imported by ${importer}`;
  }
}

function specifierError(specifier, owner) {
  if (specifier === '@getpaseo/plugin/client/host') return 'host-private';
  if ((specifier === '@getpaseo/plugin' || specifier.startsWith('@getpaseo/plugin/')) && !SDK.includes(specifier)) {
    return 'Unknown SDK';
  }
  if (owner !== 'server' && (isBuiltin(specifier) || specifier === '@types/node')) return 'Node';
  if (owner !== 'server' && SERVER_SDK.includes(specifier)) return 'server-only';
  if (owner !== 'client' && (CLIENT_SDK.includes(specifier) || CLIENT_ONLY.test(specifier))) return 'client-only';
  return null;
}

function placementError(specifier, importer, owner) {
  if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return null;
  const place = placeOf(path.resolve(path.dirname(importer), specifier));
  if (place === 'invalid') return `Plugin modules belong in client/, server/, or shared/: ${specifier} imported by ${importer}`;
  if (place === 'outside') return `Module escapes installed plugin: ${specifier} imported by ${importer}`;
  if (place === null || place === 'shared' || place === owner) return null;
  return `${place}-only module cannot be imported into the plugin ${owner} bundle: ${specifier} imported by ${importer}`;
}

function boundary(target) {
  const ownerOf = (file) => (placeOf(file) === 'shared' ? 'shared' : target);
  const check = (specifier, importer) => {
    const owner = ownerOf(importer);
    const kind = specifierError(specifier, owner);
    if (kind) return `${kind} module cannot be imported into the plugin ${owner} bundle: ${specifier} imported by ${importer}`;
    return placementError(specifier, importer, owner);
  };
  return {
    name: `agy-${target}-boundary`,
    setup(context) {
      context.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
        const place = placeOf(args.path);
        if (place === 'outside') return { errors: [{ text: `Module escapes installed plugin: ${args.path}` }] };
        if (place === null) return null;
        for (const match of readFileSync(args.path, 'utf8').matchAll(IMPORTS)) {
          const specifier = match[2] ?? match[3];
          const error = check(specifier, args.path) ?? installError(specifier, args.path, Boolean(match[1]));
          if (error) return { errors: [{ text: error }] };
        }
        return null;
      });
      context.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') return null;
        const error = check(args.path, args.importer);
        return error ? { errors: [{ text: error }] } : null;
      });
    },
  };
}

function bundle(entry, target) {
  return build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: 'cjs',
    jsx: 'automatic',
    platform: target === 'server' ? 'node' : 'neutral',
    target: target === 'server' ? 'node20' : 'es2020',
    mainFields: target === 'client' ? ['module', 'main'] : undefined,
    supported: target === 'client' ? { 'async-await': false } : undefined,
    external:
      target === 'client'
        ? [...SDK, '@tanstack/react-query', 'react', 'react/jsx-runtime', 'react-native', 'zod']
        : [...SDK, 'zod'],
    plugins: [boundary(target)],
    logLevel: 'silent',
    treeShaking: true,
    write: false,
  });
}

function classSyntaxErrors(code) {
  const parsed = ts.createSourceFile('client.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const modules = [...code.matchAll(/^\/\/ (.+)$/gm)].map((match) => ({
    at: match.index,
    file: path.relative(root, path.resolve(match[1])),
  }));
  const errors = [];
  const visit = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const start = node.getStart(parsed);
      const file = modules.findLast((m) => m.at < start)?.file ?? 'client bundle';
      errors.push(`${file}: class syntax reaches the Hermes client bundle; use functions instead`);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return errors;
}

function browserDomErrors(code) {
  const parsed = ts.createSourceFile('client.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const errors = [];
  const calleeName = (callee) =>
    ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      let callee = node.expression;
      if (
        ts.isParenthesizedExpression(callee) &&
        ts.isBinaryExpression(callee.expression) &&
        callee.expression.operatorToken.kind === ts.SyntaxKind.CommaToken
      ) {
        callee = callee.expression.right;
      }
      const name = calleeName(callee);
      const first = node.arguments[0];
      if (name && /^(createElement|jsx|jsxs|jsxDEV|_jsx|_jsxs)$/.test(name) && first && ts.isStringLiteralLike(first)) {
        errors.push(`DOM element <${first.text}> created in client bundle; use React Native primitives instead`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return errors;
}

function serverEvalErrors(code) {
  const mod = { exports: {} };
  const hostRequire = createRequire(import.meta.url);
  try {
    vm.runInNewContext(code, {
      require: (specifier) => hostRequire(specifier),
      module: mod,
      exports: mod.exports,
      process,
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      queueMicrotask,
    });
    return [];
  } catch (error) {
    return [`server bundle failed CJS evaluation: ${error instanceof Error ? error.message : String(error)}`];
  }
}

const results = await Promise.allSettled([bundle('index.client.tsx', 'client'), bundle('index.server.ts', 'server')]);
rmSync(root, { recursive: true, force: true });

const failures = results.flatMap((result) =>
  result.status === 'rejected'
    ? result.reason.errors?.map((e) => `${e.location ? `${e.location.file}:${e.location.line}: ` : ''}${e.text}`) ?? [
        String(result.reason),
      ]
    : []
);

if (results[0].status === 'fulfilled') {
  const clientCode = results[0].value.outputFiles[0].text;
  failures.push(...classSyntaxErrors(clientCode), ...browserDomErrors(clientCode));
}
if (results[1].status === 'fulfilled') {
  failures.push(...serverEvalErrors(results[1].value.outputFiles[0].text));
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('client and server bundles build cleanly for Paseo (Hermes + CJS)');

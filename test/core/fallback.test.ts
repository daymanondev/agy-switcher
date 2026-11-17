import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  syncFallbackFile,
  removeFallbackFile,
} from '../../src/core/fallback.ts';
import type { AntigravityPayload } from '../../src/core/types.ts';

describe('Fallback File Synchronization', () => {
  let tempDir: string;
  let testFilePath: string;

  const samplePayload: AntigravityPayload = {
    token: {
      access_token: 'ya29.fallback-access-token',
      token_type: 'Bearer',
      refresh_token: '1//fallback-refresh-token',
      expiry: '2026-11-16T19:00:00.000Z',
      expires_in: 3600,
    },
    auth_method: 'consumer',
    id_token_email: 'fallback@example.com',
  };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-fallback-test-'));
    testFilePath = path.join(tempDir, 'jetski-standalone-oauth-token');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('atomically writes plain JSON to target file with 0o600 permissions', async () => {
    await syncFallbackFile(samplePayload, testFilePath);

    const exists = await fs
      .access(testFilePath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, true);

    const content = await fs.readFile(testFilePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.deepEqual(parsed, samplePayload);

    // Verify file permissions 0o600 (-rw-------)
    const stat = await fs.stat(testFilePath);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600, `Expected file mode 0o600, got 0o${mode.toString(8)}`);

    // Verify no temporary files remain in directory
    const dirFiles = await fs.readdir(tempDir);
    assert.deepEqual(dirFiles, ['jetski-standalone-oauth-token']);
  });

  it('atomically overwrites an existing file and updates content', async () => {
    await syncFallbackFile(samplePayload, testFilePath);

    const updatedPayload: AntigravityPayload = {
      ...samplePayload,
      id_token_email: 'updated@example.com',
      token: {
        ...samplePayload.token,
        access_token: 'ya29.updated-access-token',
      },
    };

    await syncFallbackFile(updatedPayload, testFilePath);

    const content = await fs.readFile(testFilePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.id_token_email, 'updated@example.com');
    assert.equal(parsed.token.access_token, 'ya29.updated-access-token');

    const stat = await fs.stat(testFilePath);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it('creates parent directories if they do not exist', async () => {
    const deepFilePath = path.join(tempDir, 'nested', 'deep', 'jetski-standalone-oauth-token');
    await syncFallbackFile(samplePayload, deepFilePath);

    const content = await fs.readFile(deepFilePath, 'utf8');
    const parsed = JSON.parse(content);
    assert.deepEqual(parsed, samplePayload);
  });

  it('removeFallbackFile removes file cleanly if present', async () => {
    await syncFallbackFile(samplePayload, testFilePath);

    let exists = await fs
      .access(testFilePath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, true);

    await removeFallbackFile(testFilePath);

    exists = await fs
      .access(testFilePath)
      .then(() => true)
      .catch(() => false);
    assert.equal(exists, false);
  });

  it('removeFallbackFile does not throw when file does not exist', async () => {
    const nonexistent = path.join(tempDir, 'does-not-exist');
    await assert.doesNotReject(() => removeFallbackFile(nonexistent));
  });
});

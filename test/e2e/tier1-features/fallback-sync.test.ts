import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTestContext, type TestContext } from '../harness/test-context.ts';
import { syncFallbackFile, removeFallbackFile } from '../../../src/core/fallback.ts';
import type { AntigravityPayload } from '../../../src/core/types.ts';

describe('Tier 1: Fallback Token File Synchronization', () => {
  let ctx: TestContext;
  const samplePayload: AntigravityPayload = {
    token: {
      access_token: 'ya29.fallback-access-token',
      token_type: 'Bearer',
      refresh_token: '1//fallback-refresh-token',
      expiry: '2026-11-16T20:00:00.000Z',
      expires_in: 3600,
    },
    auth_method: 'consumer',
    id_token_email: 'fallback@example.com',
  };

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. writes fallback file on switch with plain unprefixed JSON', async () => {
    const targetPath = ctx.fs.getFallbackTokenPath();
    await syncFallbackFile(samplePayload, targetPath);

    assert.equal(ctx.fs.existsFallback(), true);
    const content = ctx.fs.readFallback();
    assert.deepEqual(content, samplePayload);
    // Verify no go-keyring-base64: prefix in the file
    const raw = ctx.fs.readFallbackRaw();
    assert.ok(!raw?.startsWith('go-keyring-base64:'));
  });

  it('2. safely deletes/clears fallback token file', async () => {
    const targetPath = ctx.fs.getFallbackTokenPath();
    await syncFallbackFile(samplePayload, targetPath);
    assert.equal(ctx.fs.existsFallback(), true);

    await removeFallbackFile(targetPath);
    assert.equal(ctx.fs.existsFallback(), false);

    // Calling remove on non-existent file does not throw
    await assert.doesNotReject(() => removeFallbackFile(targetPath));
  });

  it('3. strictly enforces 0600 file permissions (-rw-------)', async () => {
    const targetPath = ctx.fs.getFallbackTokenPath();
    await syncFallbackFile(samplePayload, targetPath);

    const mode = ctx.fs.getFallbackFileMode();
    assert.equal(mode, 0o600);
  });

  it('4. ensures atomic write via temporary file rename', async () => {
    const targetPath = ctx.fs.getFallbackTokenPath();
    // Overwrite existing file atomically
    await syncFallbackFile(samplePayload, targetPath);

    const updatedPayload: AntigravityPayload = {
      ...samplePayload,
      token: {
        ...samplePayload.token,
        access_token: 'ya29.updated-token',
      },
    };
    await syncFallbackFile(updatedPayload, targetPath);

    const current = ctx.fs.readFallback();
    assert.equal(current.token.access_token, 'ya29.updated-token');
    // Ensure no orphan temporary files left in ~/.gemini
    const geminiDir = ctx.fs.getGeminiDir();
    const files = fs.readdirSync(geminiDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp.'));
    assert.equal(tmpFiles.length, 0);
  });

  it('5. parses existing fallback file accurately', async () => {
    ctx.fs.writeFallback(samplePayload, 0o600);
    const parsed = ctx.fs.readFallback();

    assert.equal(parsed.token.access_token, 'ya29.fallback-access-token');
    assert.equal(parsed.id_token_email, 'fallback@example.com');
  });
});

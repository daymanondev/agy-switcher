import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 3: Cross-Feature: Profile Switch & Fallback File Synchronization', () => {
  let ctx: TestContext;
  const payloadWork = {
    token: { access_token: 'ya29.work-access', refresh_token: '1//work', token_type: 'Bearer' },
    id_token_email: 'engineer@corp.com',
  };
  const payloadPersonal = {
    token: { access_token: 'ya29.personal-access', refresh_token: '1//personal', token_type: 'Bearer' },
    id_token_email: 'dev@gmail.com',
  };

  const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadWork)).toString('base64')}`;
  const rawPersonal = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadPersonal)).toString('base64')}`;

  beforeEach(async () => {
    ctx = await createTestContext();
    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawWork);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawPersonal);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. switching to "work" synchronizes fallback token file with work credentials', async () => {
    const res = await ctx.cli.run(['use', 'work']);
    assert.equal(res.exitCode, 0);

    assert.equal(ctx.fs.existsFallback(), true);
    const content = ctx.fs.readFallback();
    assert.equal(content.id_token_email, 'engineer@corp.com');
    assert.equal(content.token.access_token, 'ya29.work-access');
  });

  it('2. verifies 0600 file permissions are preserved across multiple profile switches', async () => {
    await ctx.cli.run(['use', 'work']);
    assert.equal(ctx.fs.getFallbackFileMode(), 0o600);

    await ctx.cli.run(['use', 'personal']);
    assert.equal(ctx.fs.getFallbackFileMode(), 0o600);
  });

  it('3. consecutive atomic switches produce zero dangling temporary files', async () => {
    for (let i = 0; i < 5; i++) {
      const alias = i % 2 === 0 ? 'work' : 'personal';
      await ctx.cli.run(['use', alias]);
    }

    const geminiDir = ctx.fs.getGeminiDir();
    const files = fs.readdirSync(geminiDir);
    const tempFiles = files.filter((f) => f.includes('.tmp.'));
    assert.equal(tempFiles.length, 0);
  });

  it('4. fallback file contains clean unprefixed JSON matching IDE requirements', async () => {
    await ctx.cli.run(['use', 'personal']);

    const raw = ctx.fs.readFallbackRaw();
    assert.ok(raw);
    assert.ok(!raw.startsWith('go-keyring-base64:'));
    assert.doesNotThrow(() => JSON.parse(raw));
  });

  it('5. removing inactive profile does not alter active fallback file', async () => {
    await ctx.cli.run(['use', 'work']);
    const beforeContent = ctx.fs.readFallback();

    await ctx.cli.run(['rm', 'personal']);
    const afterContent = ctx.fs.readFallback();

    assert.deepEqual(beforeContent, afterContent);
    assert.equal(afterContent.id_token_email, 'engineer@corp.com');
  });
});

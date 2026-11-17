import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 4 Scenario 5: Corrupted Fallback File Self-Healing Recovery Workflow', () => {
  let ctx: TestContext;
  const validPayload = {
    token: { access_token: 'ya29.valid-recovered', refresh_token: '1//recovered', token_type: 'Bearer' },
    auth_method: 'consumer',
    id_token_email: 'dev@recovery.com',
  };
  const rawValid = `go-keyring-base64:${Buffer.from(JSON.stringify(validPayload)).toString('base64')}`;

  beforeEach(async () => {
    ctx = await createTestContext();
    ctx.keychain.setItem('gemini', 'antigravity-profile:safe', rawValid);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('Step 1: simulate disk corruption on ~/.gemini/jetski-standalone-oauth-token', () => {
    // Write corrupted truncated garbage with permissive 0777 mode
    ctx.fs.writeFallback('{"token": {"access_token": "broken-trunc...', 0o777);

    assert.equal(ctx.fs.existsFallback(), true);
    assert.equal(ctx.fs.readFallback(), null); // Parser fails gracefully
    assert.notEqual(ctx.fs.getFallbackFileMode(), 0o600);
  });

  it('Step 2: trigger profile switch using safe profile stored in Keychain', async () => {
    // Corrupt fallback file first
    ctx.fs.writeFallback('{"token": {"access_token": "broken-trunc...', 0o777);

    const res = await ctx.cli.run(['use', 'safe']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Switched active profile to 'safe'/);
  });

  it('Step 3: verify self-healing replaced corrupted file with valid JSON', async () => {
    ctx.fs.writeFallback('garbage-data-from-crash', 0o644);

    await ctx.cli.run(['use', 'safe']);

    const healed = ctx.fs.readFallback();
    assert.ok(healed);
    assert.equal(healed.id_token_email, 'dev@recovery.com');
    assert.equal(healed.token.access_token, 'ya29.valid-recovered');
  });

  it('Step 4: verify file permissions are strictly repaired to 0600 (-rw-------)', async () => {
    // Set loose permissions
    ctx.fs.writeFallback('garbage', 0o777);

    await ctx.cli.run(['use', 'safe']);

    const mode = ctx.fs.getFallbackFileMode();
    assert.equal(mode, 0o600);
  });

  it('Step 5: verify primary Keychain slot remains intact and healthy', async () => {
    await ctx.cli.run(['use', 'safe']);

    const active = ctx.keychain.getItem('gemini', 'antigravity');
    assert.equal(active, rawValid);
  });
});

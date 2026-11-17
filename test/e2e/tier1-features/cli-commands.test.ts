import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 1: CLI Commands & Terminal Output', () => {
  let ctx: TestContext;
  const samplePayloadA = {
    token: {
      access_token: 'ya29.token-a',
      token_type: 'Bearer',
      refresh_token: '1//refresh-a',
      expiry: '2026-11-16T22:00:00Z',
    },
    auth_method: 'consumer',
    id_token_email: 'work@example.com',
  };
  const samplePayloadB = {
    token: {
      access_token: 'ya29.token-b',
      token_type: 'Bearer',
      refresh_token: '1//refresh-b',
      expiry: '2026-11-16T22:00:00Z',
    },
    auth_method: 'consumer',
    id_token_email: 'personal@example.com',
  };

  beforeEach(async () => {
    ctx = await createTestContext();
    // Setup active profile in primary keychain slot
    const raw = `go-keyring-base64:${Buffer.from(JSON.stringify(samplePayloadA)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity', raw);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. save <alias> saves active profile into profile slot', async () => {
    const res = await ctx.cli.run(['save', 'work']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Saved current profile as 'work'/);

    const stored = ctx.keychain.getItem('gemini', 'antigravity-profile:work');
    assert.ok(stored);
    assert.ok(stored.includes('go-keyring-base64:'));
  });

  it('2. ls lists configured profiles in tabular layout', async () => {
    // Save two profiles
    await ctx.cli.run(['save', 'work']);
    const rawB = `go-keyring-base64:${Buffer.from(JSON.stringify(samplePayloadB)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawB);

    const res = await ctx.cli.run(['ls']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /ALIAS/);
    assert.match(res.stdout, /work/);
    assert.match(res.stdout, /personal/);
    assert.match(res.stdout, /5H QUOTA/);
  });

  it('3. use <alias> switches active profile and syncs fallback file', async () => {
    const rawB = `go-keyring-base64:${Buffer.from(JSON.stringify(samplePayloadB)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawB);

    const res = await ctx.cli.run(['use', 'personal']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Switched active profile to 'personal'/);

    // Active keychain slot updated
    const active = ctx.keychain.getItem('gemini', 'antigravity');
    assert.equal(active, rawB);

    // Fallback file written
    assert.equal(ctx.fs.existsFallback(), true);
    const fallback = ctx.fs.readFallback();
    assert.equal(fallback.id_token_email, 'personal@example.com');
  });

  it('4. best switches active profile to the one with highest quota score', async () => {
    const rawA = `go-keyring-base64:${Buffer.from(JSON.stringify(samplePayloadA)).toString('base64')}`;
    const rawB = `go-keyring-base64:${Buffer.from(JSON.stringify(samplePayloadB)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawA);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawB);

    const res = await ctx.cli.run(['best']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Selected '.*' as best profile/);
    assert.match(res.stdout, /Switched active profile to/);
  });

  it('5. rm <alias> removes profile from Keychain', async () => {
    const rawB = `go-keyring-base64:${Buffer.from(JSON.stringify(samplePayloadB)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:temp', rawB);

    const res = await ctx.cli.run(['rm', 'temp']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Removed profile 'temp'/);

    const item = ctx.keychain.getItem('gemini', 'antigravity-profile:temp');
    assert.equal(item, null);
  });
});

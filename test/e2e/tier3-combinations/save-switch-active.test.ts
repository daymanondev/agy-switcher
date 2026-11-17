import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 3: Cross-Feature: Save, Switch & Active State Lifecycle', () => {
  let ctx: TestContext;
  const payloadA = {
    token: { access_token: 'ya29.token-alpha', refresh_token: '1//alpha', token_type: 'Bearer' },
    id_token_email: 'alpha@company.com',
  };
  const payloadB = {
    token: { access_token: 'ya29.token-beta', refresh_token: '1//beta', token_type: 'Bearer' },
    id_token_email: 'beta@personal.org',
  };

  const rawA = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadA)).toString('base64')}`;
  const rawB = `go-keyring-base64:${Buffer.from(JSON.stringify(payloadB)).toString('base64')}`;

  beforeEach(async () => {
    ctx = await createTestContext();
    // Start with alpha as active in primary slot
    ctx.keychain.setItem('gemini', 'antigravity', rawA);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. saves active credentials to profile alias "alpha"', async () => {
    const res = await ctx.cli.run(['save', 'alpha']);
    assert.equal(res.exitCode, 0);

    const stored = ctx.keychain.getItem('gemini', 'antigravity-profile:alpha');
    assert.equal(stored, rawA);
  });

  it('2. saves secondary profile "beta" and switches active slot to "beta"', async () => {
    await ctx.cli.run(['save', 'alpha']);
    ctx.keychain.setItem('gemini', 'antigravity-profile:beta', rawB);

    const switchRes = await ctx.cli.run(['use', 'beta']);
    assert.equal(switchRes.exitCode, 0);

    const activeRaw = ctx.keychain.getItem('gemini', 'antigravity');
    assert.equal(activeRaw, rawB);
  });

  it('3. switches back to "alpha" and verifies active credentials update', async () => {
    await ctx.cli.run(['save', 'alpha']);
    ctx.keychain.setItem('gemini', 'antigravity-profile:beta', rawB);

    await ctx.cli.run(['use', 'beta']);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity'), rawB);

    const switchBack = await ctx.cli.run(['use', 'alpha']);
    assert.equal(switchBack.exitCode, 0);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity'), rawA);
  });

  it('4. deleting profile "beta" does not affect active profile "alpha"', async () => {
    await ctx.cli.run(['save', 'alpha']);
    ctx.keychain.setItem('gemini', 'antigravity-profile:beta', rawB);

    const rmRes = await ctx.cli.run(['rm', 'beta']);
    assert.equal(rmRes.exitCode, 0);

    assert.equal(ctx.keychain.getItem('gemini', 'antigravity-profile:beta'), null);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity'), rawA);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity-profile:alpha'), rawA);
  });

  it('5. profile list marks newly switched profile as active', async () => {
    await ctx.cli.run(['save', 'alpha']);
    ctx.keychain.setItem('gemini', 'antigravity-profile:beta', rawB);

    await ctx.cli.run(['use', 'beta']);
    const lsRes = await ctx.cli.run(['ls']);
    assert.equal(lsRes.exitCode, 0);

    const lines = lsRes.stdout.split('\n');
    const betaLine = lines.find((l) => l.includes('beta'));
    const alphaLine = lines.find((l) => l.includes('alpha'));

    assert.ok(betaLine?.includes('* active'));
    assert.ok(!alphaLine?.includes('* active'));
  });
});

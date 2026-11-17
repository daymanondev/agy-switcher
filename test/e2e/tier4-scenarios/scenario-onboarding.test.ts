import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 4 Scenario 1: Multi-Account Onboarding & Inventory Workflow', () => {
  let ctx: TestContext;
  const tokenWork = { access_token: 'ya29.work', refresh_token: '1//work', token_type: 'Bearer' };
  const tokenPersonal = { access_token: 'ya29.personal', refresh_token: '1//personal', token_type: 'Bearer' };
  const tokenConsulting = { access_token: 'ya29.consulting', refresh_token: '1//consulting', token_type: 'Bearer' };

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('Step 1: onboard initial work profile from active Antigravity session', async () => {
    const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenWork, id_token_email: 'emp@enterprise.com' })).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity', rawWork);

    const res = await ctx.cli.run(['save', 'work']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /Saved current profile as 'work'/);
  });

  it('Step 2: onboard personal and consulting accounts into secondary slots', async () => {
    const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenWork, id_token_email: 'emp@enterprise.com' })).toString('base64')}`;
    const rawPersonal = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenPersonal, id_token_email: 'me@gmail.com' })).toString('base64')}`;
    const rawConsulting = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenConsulting, id_token_email: 'client@freelance.org' })).toString('base64')}`;

    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawWork);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawPersonal);
    ctx.keychain.setItem('gemini', 'antigravity-profile:consulting', rawConsulting);

    const accounts = ctx.keychain.listAccounts('gemini', 'antigravity-profile:');
    assert.equal(accounts.length, 3);
  });

  it('Step 3: list all onboarded accounts in unified inventory', async () => {
    const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenWork, id_token_email: 'emp@enterprise.com' })).toString('base64')}`;
    const rawPersonal = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenPersonal, id_token_email: 'me@gmail.com' })).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawWork);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawPersonal);
    ctx.keychain.setItem('gemini', 'antigravity', rawWork);

    const lsRes = await ctx.cli.run(['ls']);
    assert.equal(lsRes.exitCode, 0);
    assert.match(lsRes.stdout, /work/);
    assert.match(lsRes.stdout, /personal/);
    assert.match(lsRes.stdout, /emp@enterprise.com/);
  });

  it('Step 4: cycle switch through accounts and verify atomic fallback file sync', async () => {
    const rawWork = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenWork, id_token_email: 'emp@enterprise.com' })).toString('base64')}`;
    const rawPersonal = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenPersonal, id_token_email: 'me@gmail.com' })).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:work', rawWork);
    ctx.keychain.setItem('gemini', 'antigravity-profile:personal', rawPersonal);

    await ctx.cli.run(['use', 'personal']);
    assert.equal(ctx.fs.readFallback().id_token_email, 'me@gmail.com');
    assert.equal(ctx.fs.getFallbackFileMode(), 0o600);

    await ctx.cli.run(['use', 'work']);
    assert.equal(ctx.fs.readFallback().id_token_email, 'emp@enterprise.com');
    assert.equal(ctx.fs.getFallbackFileMode(), 0o600);
  });

  it('Step 5: offboard consulting account when project concludes', async () => {
    const rawConsulting = `go-keyring-base64:${Buffer.from(JSON.stringify({ token: tokenConsulting, id_token_email: 'client@freelance.org' })).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity-profile:consulting', rawConsulting);

    const rmRes = await ctx.cli.run(['rm', 'consulting']);
    assert.equal(rmRes.exitCode, 0);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity-profile:consulting'), null);
  });
});

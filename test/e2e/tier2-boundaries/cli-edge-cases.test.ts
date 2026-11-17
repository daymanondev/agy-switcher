import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 2: CLI Edge Cases & Flag Behaviors', () => {
  let ctx: TestContext;
  const samplePayload = {
    token: { access_token: 'ya29.edge', refresh_token: '1//edge', token_type: 'Bearer' },
    id_token_email: 'edge@example.com',
  };

  beforeEach(async () => {
    ctx = await createTestContext();
    const raw = `go-keyring-base64:${Buffer.from(JSON.stringify(samplePayload)).toString('base64')}`;
    ctx.keychain.setItem('gemini', 'antigravity', raw);
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. save duplicate alias without --force returns error exit code 1', async () => {
    // Initial save
    const res1 = await ctx.cli.run(['save', 'existing']);
    assert.equal(res1.exitCode, 0);

    // Duplicate save without force
    const res2 = await ctx.cli.run(['save', 'existing']);
    assert.equal(res2.exitCode, 1);
    assert.match(res2.stderr, /already exists/);
  });

  it('2. save duplicate alias with --force overwrites successfully', async () => {
    await ctx.cli.run(['save', 'existing']);

    const resForce = await ctx.cli.run(['save', 'existing', '--force']);
    assert.equal(resForce.exitCode, 0);
    assert.match(resForce.stdout, /Saved current profile as 'existing'/);
  });

  it('3. use non-existent alias returns error code 1 and descriptive error message', async () => {
    const res = await ctx.cli.run(['use', 'phantom-account']);
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /Profile 'phantom-account' not found/);
  });

  it('4. rm non-existent alias returns error code 1', async () => {
    const res = await ctx.cli.run(['rm', 'phantom-account']);
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /Profile 'phantom-account' not found/);
  });

  it('5. unknown subcommand returns error exit code 1', async () => {
    const res = await ctx.cli.run(['invalid-command-xyz']);
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /unknown command 'invalid-command-xyz'/);
  });
});

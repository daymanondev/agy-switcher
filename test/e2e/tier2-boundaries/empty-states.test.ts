import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';
import { parseKeyringPayload } from '../../../src/core/keychain.ts';
import { TokenParseError } from '../../../src/core/errors.ts';

describe('Tier 2: Empty States & Zero-Item Boundaries', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. empty keychain: ls outputs header and zero profile rows cleanly', async () => {
    const res = await ctx.cli.run(['ls']);
    assert.equal(res.exitCode, 0);
    assert.match(res.stdout, /ALIAS/);
    // No data rows below header
    const lines = res.stdout.trim().split('\n');
    assert.equal(lines.length, 2); // header and separator only
  });

  it('2. empty keychain: best command reports error with zero profiles configured', async () => {
    const res = await ctx.cli.run(['best']);
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /No profiles configured/);
  });

  it('3. empty alias rejection on save and use commands', async () => {
    const resSave = await ctx.cli.run(['save', '']);
    assert.equal(resSave.exitCode, 1);
    assert.match(resSave.stderr, /missing required argument: alias/);

    const resUse = await ctx.cli.run(['use', '']);
    assert.equal(resUse.exitCode, 1);
    assert.match(resUse.stderr, /missing required argument: alias/);
  });

  it('4. save fails gracefully when active slot is empty in Keychain', async () => {
    // Keychain has no active profile
    const res = await ctx.cli.run(['save', 'work']);
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /No active Antigravity profile found/);
  });

  it('5. empty token object inside payload throws TokenParseError', () => {
    const emptyTokenPayload = JSON.stringify({ token: {}, auth_method: 'consumer' });
    assert.throws(() => parseKeyringPayload(emptyTokenPayload), TokenParseError);
  });
});

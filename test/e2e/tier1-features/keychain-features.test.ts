import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';
import { MacKeychainService } from '../../../src/core/keychain.ts';

describe('Tier 1: Keychain CRUD & Security Features', () => {
  let ctx: TestContext;
  let keychainService: MacKeychainService;

  beforeEach(async () => {
    ctx = await createTestContext();
    keychainService = new MacKeychainService({
      securityBin: ctx.keychain.getSecurityBinPath(),
      execFileFn: ctx.keychain.execFileFn,
    });
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. reads valid generic password from primary slot', async () => {
    const rawPayload = 'go-keyring-base64:eyJ0b2tlbiI6eyJhY2Nlc3NfdG9rZW4iOiJ0ZXN0In19';
    ctx.keychain.setItem('gemini', 'antigravity', rawPayload);

    const result = await keychainService.findGenericPassword('gemini', 'antigravity');
    assert.equal(result, rawPayload);
  });

  it('2. writes new generic password with atomic upsert flag', async () => {
    const secret = 'go-keyring-base64:new-profile-payload';
    await keychainService.addGenericPassword('gemini', 'antigravity-profile:dev', secret);

    const stored = ctx.keychain.getItem('gemini', 'antigravity-profile:dev');
    assert.equal(stored, secret);
  });

  it('3. deletes existing profile item and returns true', async () => {
    ctx.keychain.setItem('gemini', 'antigravity-profile:obsolete', 'secret-data');

    const deleted = await keychainService.deleteGenericPassword('gemini', 'antigravity-profile:obsolete');
    assert.equal(deleted, true);
    assert.equal(ctx.keychain.getItem('gemini', 'antigravity-profile:obsolete'), null);
  });

  it('4. lists profile accounts matching service and prefix', async () => {
    ctx.keychain.setItem('gemini', 'antigravity', 'active');
    ctx.keychain.setItem('gemini', 'antigravity-profile:alpha', 'secret-alpha');
    ctx.keychain.setItem('gemini', 'antigravity-profile:beta', 'secret-beta');
    ctx.keychain.setItem('other-service', 'antigravity-profile:gamma', 'secret-gamma');

    const accounts = await keychainService.listAccounts('gemini', 'antigravity-profile:');
    assert.deepEqual(accounts.sort(), [
      'antigravity-profile:alpha',
      'antigravity-profile:beta',
    ]);
  });

  it('5. returns null cleanly without throwing on exit code 44 (item not found)', async () => {
    const result = await keychainService.findGenericPassword('gemini', 'nonexistent-profile');
    assert.equal(result, null);

    const deleted = await keychainService.deleteGenericPassword('gemini', 'nonexistent-profile');
    assert.equal(deleted, false);
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';
import { parseKeyringPayload, KEYRING_PREFIX } from '../../../src/core/keychain.ts';
import { TokenParseError } from '../../../src/core/errors.ts';

describe('Tier 2: Corrupted Payloads & Encoding Integrity', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. rejects invalid non-base64 character sequence', () => {
    const corruptPayload = `${KEYRING_PREFIX}???not-base64-data???`;
    assert.throws(
      () => parseKeyringPayload(corruptPayload),
      (err: unknown) => {
        assert.ok(err instanceof TokenParseError);
        return true;
      }
    );
  });

  it('2. rejects valid base64 that decodes to non-JSON string', () => {
    const base64NonJson = Buffer.from('this is plain text, not JSON').toString('base64');
    const corruptPayload = `${KEYRING_PREFIX}${base64NonJson}`;

    assert.throws(
      () => parseKeyringPayload(corruptPayload),
      (err: unknown) => {
        assert.ok(err instanceof TokenParseError);
        assert.match((err as TokenParseError).message, /Failed to parse JSON payload/);
        return true;
      }
    );
  });

  it('3. rejects arbitrary non-JSON string without prefix', () => {
    assert.throws(
      () => parseKeyringPayload('random-unprefixed-garbage-data'),
      TokenParseError
    );
  });

  it('4. detects and handles truncated/corrupted fallback token file on disk', () => {
    // Write partial/corrupted JSON file to fallback path
    ctx.fs.writeFallback('{ "token": { "access_token": "ya29.trunca... ');

    const parsed = ctx.fs.readFallback();
    assert.equal(parsed, null); // Gracefully returns null on malformed JSON

    const raw = ctx.fs.readFallbackRaw();
    assert.ok(raw?.includes('ya29.trunca'));
  });

  it('5. rejects payload missing access_token or refresh_token', () => {
    const missingAccessToken = JSON.stringify({
      token: {
        refresh_token: '1//refresh-only',
        token_type: 'Bearer',
      },
    });
    assert.throws(() => parseKeyringPayload(missingAccessToken), TokenParseError);

    const missingRefreshToken = JSON.stringify({
      token: {
        access_token: 'ya29.access-only',
        token_type: 'Bearer',
      },
    });
    assert.throws(() => parseKeyringPayload(missingRefreshToken), TokenParseError);
  });
});

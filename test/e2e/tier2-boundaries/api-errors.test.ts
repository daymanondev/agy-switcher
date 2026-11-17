import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext, type TestContext } from '../harness/test-context.ts';

describe('Tier 2: Upstream API Errors & Network Resilience', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.teardown();
  });

  it('1. handles HTTP 401 Unauthorized from Cloud Code Assist gracefully', async () => {
    ctx.server.setError('loadCodeAssist', 401, {
      error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' },
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer expired-or-invalid' },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error.status, 'UNAUTHENTICATED');
  });

  it('2. handles HTTP 429 Rate Limit (RESOURCE_EXHAUSTED)', async () => {
    ctx.server.setError('retrieveUserQuotaSummary', 429, {
      error: { code: 429, message: 'Quota exceeded for project', status: 'RESOURCE_EXHAUSTED' },
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuotaSummary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ project: 'projects/1071006060591' }),
    });

    assert.equal(res.status, 429);
    const data = await res.json();
    assert.equal(data.error.status, 'RESOURCE_EXHAUSTED');
  });

  it('3. handles HTTP 500 Internal Server Error', async () => {
    ctx.server.setError('retrieveUserQuota', 500, {
      error: { code: 500, message: 'Internal backend failure', status: 'INTERNAL' },
    });

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:retrieveUserQuota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ project: 'projects/1071006060591' }),
    });

    assert.equal(res.status, 500);
    const data = await res.json();
    assert.equal(data.error.code, 500);
  });

  it('4. catches ECONNREFUSED network failure when server is offline', async () => {
    // Port 1 is reserved and guaranteed not listening locally
    const unreachableUrl = 'http://127.0.0.1:1/v1internal:loadCodeAssist';

    await assert.rejects(
      () =>
        fetch(unreachableUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      (err: any) => {
        assert.ok(err.cause?.code === 'ECONNREFUSED' || err.message?.includes('fetch failed'));
        return true;
      }
    );
  });

  it('5. handles non-JSON / HTML 502 Bad Gateway response body', async () => {
    ctx.server.setCustomRoute('/v1internal:loadCodeAssist', () => ({
      status: 502,
      headers: { 'Content-Type': 'text/html' },
      body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
    }));

    const res = await fetch(`${ctx.server.getBaseUrl()}/v1internal:loadCodeAssist`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 502);
    const text = await res.text();
    assert.match(text, /502 Bad Gateway/);
    assert.throws(() => JSON.parse(text), SyntaxError);
  });
});

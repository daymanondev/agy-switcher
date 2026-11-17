import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CloudCodeClient, fetchAccountQuota } from '../../src/core/client.ts';
import {
  AuthTokenExpiredError,
  SubscriptionRequiredError,
  RateLimitExceededError,
  ServiceUnavailableError,
  NetworkOfflineError,
} from '../../src/core/errors.ts';
import type { OAuthToken } from '../../src/core/types.ts';

describe('CloudCodeClient (Unit Tests)', () => {
  const dummyToken: OAuthToken = {
    access_token: 'ya29.initial-access-token',
    token_type: 'Bearer',
    refresh_token: '1//refresh-token',
    expiry: new Date(Date.now() + 3600_000).toISOString(),
  };

  it('1. loadCodeAssist sends correct metadata, headers, and parses tiers and project', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);

      return new Response(
        JSON.stringify({
          cloudaicompanionProject: 'projects/1071006060591',
          currentTier: {
            id: 'g1-pro-tier',
            name: 'Google One AI Premium',
          },
          paidTier: {
            id: 'g1-pro-tier',
            name: 'Google One AI Premium',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new CloudCodeClient({
      fetchFn: mockFetch,
      token: dummyToken,
    });

    const res = await client.loadCodeAssist();

    assert.equal(capturedUrl, 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist');
    assert.equal(capturedHeaders['Authorization'], 'Bearer ya29.initial-access-token');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
    assert.deepEqual(capturedBody, {
      metadata: {
        ideType: 'ANTIGRAVITY',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
      },
    });

    assert.equal(res.cloudaicompanionProject, 'projects/1071006060591');
    assert.equal(res.currentTier?.id, 'g1-pro-tier');
    assert.equal(res.paidTier?.id, 'g1-pro-tier');
  });

  it('2. retrieveUserQuotaSummary sends project and parses 5h and weekly buckets', async () => {
    let capturedBody: any = null;

    const mockFetch: typeof fetch = async (_input, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          groups: [
            {
              displayName: 'Claude & Other Models',
              buckets: [
                {
                  bucketId: '3p-5h',
                  window: '5h',
                  remainingFraction: 0.75,
                  resetTime: '2026-11-16T21:00:00Z',
                },
                {
                  bucketId: '3p-weekly',
                  window: 'weekly',
                  remainingFraction: 0.55,
                  resetTime: '2026-11-23T00:00:00Z',
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new CloudCodeClient({
      fetchFn: mockFetch,
      token: dummyToken,
    });

    const res = await client.retrieveUserQuotaSummary('projects/1071006060591');
    assert.deepEqual(capturedBody, { project: 'projects/1071006060591' });
    assert.equal(res.groups?.[0]?.buckets?.[0]?.remainingFraction, 0.75);
    assert.equal(res.groups?.[0]?.buckets?.[1]?.remainingFraction, 0.55);
  });

  it('3. retrieveUserQuota sends project and parses Gemini models', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          buckets: [
            {
              modelId: 'gemini-2.5-pro',
              remainingFraction: 1.0,
              resetTime: '2026-11-16T18:00:00Z',
            },
            {
              modelId: 'gemini-2.5-flash',
              remainingFraction: 0.9,
              resetTime: '2026-11-16T18:00:00Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const client = new CloudCodeClient({
      fetchFn: mockFetch,
      token: dummyToken,
    });

    const res = await client.retrieveUserQuota('projects/1071006060591');
    assert.equal(res.buckets?.length, 2);
    assert.equal(res.buckets?.[0]?.modelId, 'gemini-2.5-pro');
    assert.equal(res.buckets?.[1]?.modelId, 'gemini-2.5-flash');
  });

  it('4. fetchAccountQuota orchestrates step 1 and concurrent step 2 queries', async () => {
    const requestedUrls: string[] = [];

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'projects/1071006060591',
            currentTier: { id: 'g1-pro-tier', name: 'Google One AI Premium' },
          }),
          { status: 200 }
        );
      }

      if (url.includes('retrieveUserQuotaSummary')) {
        return new Response(
          JSON.stringify({
            groups: [
              {
                buckets: [
                  { bucketId: '3p-5h', window: '5h', remainingFraction: 0.85, resetTime: '2026-11-16T21:00:00Z' },
                  { bucketId: '3p-weekly', window: 'weekly', remainingFraction: 0.62, resetTime: '2026-11-23T00:00:00Z' },
                ],
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes('retrieveUserQuota')) {
        return new Response(
          JSON.stringify({
            buckets: [
              { modelId: 'gemini-2.5-pro', remainingFraction: 1.0, resetTime: '2026-11-16T18:00:00Z' },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response('Not Found', { status: 404 });
    };

    const client = new CloudCodeClient({
      fetchFn: mockFetch,
      token: dummyToken,
    });

    const result = await client.fetchAccountQuota();

    assert.equal(requestedUrls.length, 3);
    assert.ok(requestedUrls[0].includes('loadCodeAssist'));
    assert.equal(result.project, 'projects/1071006060591');
    assert.equal(result.tier.id, 'g1-pro-tier');
    assert.equal(result.claude5h?.remainingFraction, 0.85);
    assert.equal(result.claudeWeekly?.remainingFraction, 0.62);
    assert.equal(result.gemini.length, 1);
    assert.equal(result.gemini[0].modelId, 'gemini-2.5-pro');
  });

  it('5. fetchAccountQuota gracefully degrades on null/empty project (free tier)', async () => {
    let loadCalls = 0;
    let quotaCalls = 0;

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('loadCodeAssist')) {
        loadCalls++;
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: null,
            currentTier: { id: 'free-tier', name: 'Free Tier' },
            ineligibleTiers: [
              {
                tierId: 'free-tier',
                tierName: 'Free Tier',
                reasonCode: 'UNSUPPORTED_CLIENT',
                reasonMessage: 'Individual tier is not supported',
              },
            ],
          }),
          { status: 200 }
        );
      }
      quotaCalls++;
      return new Response('Not Reached', { status: 500 });
    };

    const client = new CloudCodeClient({
      fetchFn: mockFetch,
      token: dummyToken,
    });

    const result = await client.fetchAccountQuota();

    assert.equal(loadCalls, 1);
    assert.equal(quotaCalls, 0);
    assert.equal(result.ineligible, true);
    assert.equal(result.ineligibleReason, 'Individual tier is not supported');
    assert.equal(result.project, undefined);
    assert.equal(result.tier.id, 'free-tier');
    assert.deepEqual(result.gemini, []);
  });

  it('6. transparently refreshes token on 401 Unauthorized and retries once', async () => {
    let attemptCount = 0;
    let refreshCalls = 0;
    let notifiedToken: OAuthToken | undefined = undefined;


    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);

      if (url.includes('oauth2.googleapis.com')) {
        refreshCalls++;
        return new Response(
          JSON.stringify({
            access_token: 'ya29.refreshed-access-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 }
        );
      }

      if (url.includes('loadCodeAssist')) {
        attemptCount++;
        const auth = (init?.headers as Record<string, string>)?.['Authorization'];
        if (attemptCount === 1) {
          assert.equal(auth, 'Bearer ya29.initial-access-token');
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
        }
        assert.equal(auth, 'Bearer ya29.refreshed-access-token');
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'projects/1071006060591',
            currentTier: { id: 'g1-pro-tier', name: 'Google One AI Premium' },
          }),
          { status: 200 }
        );
      }

      return new Response('Not Found', { status: 404 });
    };

    const client = new CloudCodeClient({
      fetchFn: mockFetch,
      token: dummyToken,
      onTokenRefresh: (t) => {
        notifiedToken = t;
      },
    });

    const res = await client.loadCodeAssist();

    assert.equal(attemptCount, 2);
    assert.equal(refreshCalls, 1);
    assert.equal((notifiedToken as OAuthToken | undefined)?.access_token, 'ya29.refreshed-access-token');

    assert.equal(client.getToken()?.access_token, 'ya29.refreshed-access-token');
    assert.equal(res.cloudaicompanionProject, 'projects/1071006060591');
  });

  it('7. throws AuthTokenExpiredError if retry after 401 also fails', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com')) {
        return new Response(
          JSON.stringify({
            access_token: 'ya29.second-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ error: 'Still unauthorized' }), { status: 401 });
    };

    const client = new CloudCodeClient({
      fetchFn: mockFetch,
      token: dummyToken,
    });

    await assert.rejects(
      async () => client.loadCodeAssist(),
      (err: any) => {
        assert.ok(err instanceof AuthTokenExpiredError);
        assert.equal(err.httpStatus, 401);
        return true;
      }
    );
  });

  it('8. throws AuthTokenExpiredError if 401 occurs and no refresh token exists', async () => {
    const client = new CloudCodeClient({
      fetchFn: async () => new Response('Unauthorized', { status: 401 }),
      token: {
        access_token: 'ya29.no-refresh-token',
        token_type: 'Bearer',
        refresh_token: '',
      },
    });

    await assert.rejects(
      async () => client.loadCodeAssist(),
      (err: any) => err instanceof AuthTokenExpiredError
    );
  });

  it('9. correctly classifies HTTP 403 as SubscriptionRequiredError', async () => {
    const client = new CloudCodeClient({
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: 'License required for this project',
              details: [{ reason: 'SUBSCRIPTION_REQUIRED' }],
            },
          }),
          { status: 403 }
        ),
      token: dummyToken,
    });

    await assert.rejects(
      async () => client.retrieveUserQuotaSummary('projects/12345'),
      (err: any) => {
        assert.ok(err instanceof SubscriptionRequiredError);
        assert.equal(err.httpStatus, 403);
        assert.equal(err.reason, 'SUBSCRIPTION_REQUIRED');
        assert.equal(err.project, 'projects/12345');
        return true;
      }
    );
  });

  it('10. correctly classifies HTTP 429 as RateLimitExceededError and parses Retry-After', async () => {
    const client = new CloudCodeClient({
      fetchFn: async () =>
        new Response(
          JSON.stringify({ error: { message: 'Daily limit exceeded' } }),
          { status: 429, headers: { 'Retry-After': '45' } }
        ),
      token: dummyToken,
    });

    await assert.rejects(
      async () => client.retrieveUserQuota('projects/12345'),
      (err: any) => {
        assert.ok(err instanceof RateLimitExceededError);
        assert.equal(err.httpStatus, 429);
        assert.equal(err.retryAfterSeconds, 45);
        return true;
      }
    );
  });

  it('11. correctly classifies HTTP 500 and 503 as ServiceUnavailableError', async () => {
    const client500 = new CloudCodeClient({
      fetchFn: async () => new Response('Internal Server Error', { status: 500 }),
      token: dummyToken,
    });
    await assert.rejects(
      async () => client500.loadCodeAssist(),
      (err: any) => err instanceof ServiceUnavailableError && err.httpStatus === 500
    );

    const client503 = new CloudCodeClient({
      fetchFn: async () => new Response('Service Unavailable', { status: 503 }),
      token: dummyToken,
    });
    await assert.rejects(
      async () => client503.loadCodeAssist(),
      (err: any) => err instanceof ServiceUnavailableError && err.httpStatus === 503
    );
  });

  it('12. handles 502 HTML error page gracefully without crashing JSON parser', async () => {
    const client = new CloudCodeClient({
      fetchFn: async () =>
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
      token: dummyToken,
    });

    await assert.rejects(
      async () => client.loadCodeAssist(),
      (err: any) => err instanceof ServiceUnavailableError && err.httpStatus === 502
    );
  });

  it('13. classifies network offline / connection failure as NetworkOfflineError', async () => {
    const client = new CloudCodeClient({
      fetchFn: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:443');
      },
      token: dummyToken,
    });

    await assert.rejects(
      async () => client.loadCodeAssist(),
      (err: any) => {
        assert.ok(err instanceof NetworkOfflineError);
        assert.ok(err.message.includes('ECONNREFUSED'));
        return true;
      }
    );
  });

  it('14. standalone fetchAccountQuota convenience function works with token object', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: 'projects/999',
            currentTier: { id: 'standard-tier', name: 'Gemini Code Assist' },
          }),
          { status: 200 }
        );
      }
      if (url.includes('retrieveUserQuotaSummary')) {
        return new Response(JSON.stringify({ groups: [] }), { status: 200 });
      }
      if (url.includes('retrieveUserQuota')) {
        return new Response(JSON.stringify({ buckets: [] }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    };

    const res = await fetchAccountQuota(dummyToken, { fetchFn: mockFetch });
    assert.equal(res.project, 'projects/999');
    assert.equal(res.tier.id, 'standard-tier');
  });

  it('15. standalone fetchAccountQuota works with string access_token and refresh_token', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            cloudaicompanionProject: null,
            currentTier: { id: 'free-tier', name: 'Free Tier' },
          }),
          { status: 200 }
        );
      }
      return new Response('Not Found', { status: 404 });
    };

    const res = await fetchAccountQuota('ya29.string-token', { fetchFn: mockFetch });
    assert.equal(res.ineligible, true);
    assert.equal(res.tier.id, 'free-tier');
  });
});

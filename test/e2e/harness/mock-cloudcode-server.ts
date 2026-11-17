import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
  timestamp: number;
}

export type RouteHandler = (
  req: IncomingMessage,
  body: any
) => { status?: number; headers?: Record<string, string>; body: any } | Promise<{ status?: number; headers?: Record<string, string>; body: any }>;

export class MockCloudCodeServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private baseUrl: string = '';
  public readonly requests: RecordedRequest[] = [];

  private loadCodeAssistHandler: RouteHandler | null = null;
  private quotaSummaryHandler: RouteHandler | null = null;
  private userQuotaHandler: RouteHandler | null = null;
  private tokenRefreshHandler: RouteHandler | null = null;
  private customHandlers: Map<string, RouteHandler> = new Map();

  constructor() {
    this.resetToDefaults();
  }

  public resetToDefaults(): void {
    this.requests.length = 0;
    this.customHandlers.clear();

    this.loadCodeAssistHandler = () => ({
      status: 200,
      body: {
        cloudaicompanionProject: 'projects/1071006060591',
        currentTier: {
          id: 'g1-pro-tier',
          name: 'Google One AI Premium',
          description: 'Google One AI Premium plan subscriber',
          userDefinedCloudaicompanionProject: false,
          isDefault: true,
          usesGcpTos: false,
        },
        paidTier: {
          id: 'g1-pro-tier',
          name: 'Google One AI Premium',
        },
        allowedTiers: [
          {
            id: 'standard-tier',
            name: 'Gemini Code Assist',
            description: 'Unlimited coding assistant with the most powerful Gemini models',
            userDefinedCloudaicompanionProject: true,
            isDefault: true,
            usesGcpTos: true,
          },
        ],
        ineligibleTiers: [],
      },
    });

    this.quotaSummaryHandler = () => ({
      status: 200,
      body: {
        groups: [
          {
            displayName: 'Claude & Other Models',
            description: 'Usage limits for 3rd-party models',
            buckets: [
              {
                bucketId: '3p-5h',
                displayName: '5-Hour Limit',
                description: 'Rolling 5-hour quota for Claude & GPT-OSS',
                window: '5h',
                remainingFraction: 0.85,
                remainingAmount: 850,
                disabled: false,
                resetTime: '2026-11-16T21:00:00Z',
              },
              {
                bucketId: '3p-weekly',
                displayName: 'Weekly Limit',
                description: 'Rolling 7-day quota for Claude & GPT-OSS',
                window: 'weekly',
                remainingFraction: 0.62,
                remainingAmount: 6200,
                disabled: false,
                resetTime: '2026-11-23T00:00:00Z',
              },
            ],
          },
        ],
        buckets: [],
      },
    });

    this.userQuotaHandler = () => ({
      status: 200,
      body: {
        buckets: [
          {
            modelId: 'gemini-2.5-pro',
            tokenType: 'REQUESTS',
            remainingFraction: 1.0,
            remainingAmount: 1000,
            resetTime: '2026-11-16T18:00:00Z',
          },
          {
            modelId: 'gemini-2.5-flash',
            tokenType: 'REQUESTS',
            remainingFraction: 0.95,
            remainingAmount: 950,
            resetTime: '2026-11-16T18:00:00Z',
          },
          {
            modelId: 'gemini-3.8-flash-tiered',
            tokenType: 'REQUESTS',
            remainingFraction: 0.80,
            remainingAmount: 800,
            resetTime: '2026-11-16T18:00:00Z',
          },
        ],
      },
    });

    this.tokenRefreshHandler = () => ({
      status: 200,
      body: {
        access_token: 'ya29.refreshed-access-token',
        expires_in: 3600,
        token_type: 'Bearer',
        id_token: 'eyJhbGciOi...',
      },
    });
  }

  public setLoadCodeAssistResponse(response: object | RouteHandler): void {
    if (typeof response === 'function') {
      this.loadCodeAssistHandler = response as RouteHandler;
    } else {
      this.loadCodeAssistHandler = () => ({ status: 200, body: response });
    }
  }

  public setQuotaSummaryResponse(response: object | RouteHandler): void {
    if (typeof response === 'function') {
      this.quotaSummaryHandler = response as RouteHandler;
    } else {
      this.quotaSummaryHandler = () => ({ status: 200, body: response });
    }
  }

  public setUserQuotaResponse(response: object | RouteHandler): void {
    if (typeof response === 'function') {
      this.userQuotaHandler = response as RouteHandler;
    } else {
      this.userQuotaHandler = () => ({ status: 200, body: response });
    }
  }

  public setTokenRefreshResponse(response: object | RouteHandler): void {
    if (typeof response === 'function') {
      this.tokenRefreshHandler = response as RouteHandler;
    } else {
      this.tokenRefreshHandler = () => ({ status: 200, body: response });
    }
  }

  public setError(endpoint: 'loadCodeAssist' | 'retrieveUserQuotaSummary' | 'retrieveUserQuota' | 'token', status: number, errorBody?: object): void {
    const handler: RouteHandler = () => ({
      status,
      body: errorBody ?? {
        error: {
          code: status,
          message: `Simulated error ${status} for ${endpoint}`,
          status: status === 401 ? 'UNAUTHENTICATED' : status === 429 ? 'RESOURCE_EXHAUSTED' : 'INTERNAL',
        },
      },
    });

    if (endpoint === 'loadCodeAssist') this.loadCodeAssistHandler = handler;
    else if (endpoint === 'retrieveUserQuotaSummary') this.quotaSummaryHandler = handler;
    else if (endpoint === 'retrieveUserQuota') this.userQuotaHandler = handler;
    else if (endpoint === 'token') this.tokenRefreshHandler = handler;
  }

  public setCustomRoute(path: string, handler: RouteHandler): void {
    this.customHandlers.set(path, handler);
  }

  public async start(): Promise<string> {
    if (this.server) {
      return this.baseUrl;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = req.url || '/';
        const method = req.method || 'GET';

        // Read body
        let rawBody = '';
        req.on('data', (chunk) => {
          rawBody += chunk.toString();
        });

        req.on('end', async () => {
          let parsedBody: any = null;
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              parsedBody = JSON.parse(rawBody);
            } catch {
              parsedBody = rawBody;
            }
          } else if (contentType.includes('application/x-www-form-urlencoded')) {
            parsedBody = Object.fromEntries(new URLSearchParams(rawBody));
          } else {
            parsedBody = rawBody;
          }

          this.requests.push({
            method,
            url,
            headers: req.headers,
            body: parsedBody,
            timestamp: Date.now(),
          });

          let result: { status?: number; headers?: Record<string, string>; body: any } | null = null;

          try {
            if (this.customHandlers.has(url)) {
              result = await this.customHandlers.get(url)!(req, parsedBody);
            } else if (url.includes('loadCodeAssist')) {
              result = this.loadCodeAssistHandler ? await this.loadCodeAssistHandler(req, parsedBody) : null;
            } else if (url.includes('retrieveUserQuotaSummary')) {
              result = this.quotaSummaryHandler ? await this.quotaSummaryHandler(req, parsedBody) : null;
            } else if (url.includes('retrieveUserQuota')) {
              result = this.userQuotaHandler ? await this.userQuotaHandler(req, parsedBody) : null;
            } else if (url === '/token' || url.includes('/token') || url.includes('oauth2.googleapis.com')) {
              result = this.tokenRefreshHandler ? await this.tokenRefreshHandler(req, parsedBody) : null;
            }

            if (!result) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not found' }));
              return;
            }

            let statusCode = 200;
            let responseHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            let responseBody: any;

            if (result && typeof result === 'object' && ('status' in (result as any) || 'body' in (result as any))) {
              statusCode = (result as any).status ?? 200;
              if ((result as any).headers) responseHeaders = { ...responseHeaders, ...(result as any).headers };
              responseBody = (result as any).body;
            } else {
              responseBody = result;
            }

            res.writeHead(statusCode, responseHeaders);

            if (typeof responseBody === 'string') {
              res.end(responseBody);
            } else {
              res.end(JSON.stringify(responseBody ?? {}));
            }
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
          }
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
          this.baseUrl = `http://127.0.0.1:${this.port}`;
          resolve(this.baseUrl);
        } else {
          reject(new Error('Failed to obtain server address'));
        }
      });

      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public getPort(): number {
    return this.port;
  }
}

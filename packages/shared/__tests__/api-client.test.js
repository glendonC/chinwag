import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJsonApiClient, ApiRequestError, DEFAULT_API_URL } from '../api-client.js';

describe('api-client', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function jsonResponse(data, status = 200, headers = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(Object.entries(headers)),
      json: () => Promise.resolve(data),
    };
  }

  function textResponse(text, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(),
      json: () => Promise.reject(new Error('not json')),
    };
  }

  describe('ApiRequestError', () => {
    it('constructor sets kind, status, data, and message for http errors', () => {
      const err = new ApiRequestError({
        kind: 'http',
        status: 404,
        message: 'Not found',
        data: { detail: 'missing' },
      });
      expect(err.kind).toBe('http');
      expect(err.status).toBe(404);
      expect(err.data).toEqual({ detail: 'missing' });
      expect(err.message).toBe('Not found');
      expect(err.name).toBe('ApiRequestError');
      expect(err).toBeInstanceOf(Error);
    });

    it('constructor sets kind and message for network errors', () => {
      const cause = new Error('socket hang up');
      const err = new ApiRequestError(
        { kind: 'network', message: 'Connection failed', cause },
        { cause },
      );
      expect(err.kind).toBe('network');
      expect(err.message).toBe('Connection failed');
      expect(err.cause).toBe(cause);
      expect(err.status).toBeUndefined();
      expect(err.data).toBeUndefined();
    });

    it('constructor sets kind and message for timeout errors', () => {
      const err = new ApiRequestError({ kind: 'timeout', message: 'Timed out' });
      expect(err.kind).toBe('timeout');
      expect(err.message).toBe('Timed out');
      expect(err.status).toBeUndefined();
    });

    it('constructor sets code from options', () => {
      const err = new ApiRequestError(
        { kind: 'network', message: 'fail' },
        { code: 'ECONNREFUSED' },
      );
      expect(err.code).toBe('ECONNREFUSED');
    });

    it('toApiError() returns correct shape for http kind', () => {
      const err = new ApiRequestError({
        kind: 'http',
        status: 500,
        message: 'Server error',
        data: { error: 'internal' },
      });
      const apiError = err.toApiError();
      expect(apiError).toEqual({
        kind: 'http',
        status: 500,
        message: 'Server error',
        data: { error: 'internal' },
      });
    });

    it('toApiError() returns correct shape for network kind', () => {
      const cause = new Error('DNS failure');
      const err = new ApiRequestError(
        { kind: 'network', message: 'Network error', cause },
        { cause },
      );
      const apiError = err.toApiError();
      expect(apiError).toEqual({
        kind: 'network',
        message: 'Network error',
        cause,
      });
    });

    it('toApiError() returns correct shape for timeout kind', () => {
      const err = new ApiRequestError({ kind: 'timeout', message: 'Request timed out' });
      const apiError = err.toApiError();
      expect(apiError).toEqual({
        kind: 'timeout',
        message: 'Request timed out',
      });
    });

    it('toApiError() returns undefined cause for network kind when cause is not Error', () => {
      const err = new ApiRequestError({ kind: 'network', message: 'fail' });
      const apiError = err.toApiError();
      expect(apiError.kind).toBe('network');
      expect(apiError.cause).toBeUndefined();
    });
  });

  describe('DEFAULT_API_URL', () => {
    it('exports the production API URL', () => {
      expect(DEFAULT_API_URL).toBe('https://chinmeister-api.glendonchin.workers.dev');
    });
  });

  describe('createJsonApiClient', () => {
    it('creates a client with get, post, put, del, and request methods', () => {
      const client = createJsonApiClient();
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
      expect(typeof client.put).toBe('function');
      expect(typeof client.del).toBe('function');
      expect(typeof client.request).toBe('function');
    });
  });

  describe('headers', () => {
    it('sends Content-Type header by default', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient();
      await client.get('/test');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('sends Authorization header when authToken is provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({ authToken: 'my-token' });
      await client.get('/test');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer my-token');
    });

    it('sends User-Agent header when provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({ userAgent: 'test-agent/1.0' });
      await client.get('/test');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['User-Agent']).toBe('test-agent/1.0');
    });

    it('sends X-Agent-Id header when agentId is provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({ agentId: 'cursor:abc123' });
      await client.get('/test');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Agent-Id']).toBe('cursor:abc123');
    });

    it('sends runtime identity headers when provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({
        runtimeIdentity: {
          hostTool: 'cursor',
          agentSurface: 'cline',
          transport: 'mcp',
          tier: 'connected',
        },
      });
      await client.get('/test');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Agent-Host-Tool']).toBe('cursor');
      expect(headers['X-Agent-Surface']).toBe('cline');
      expect(headers['X-Agent-Transport']).toBe('mcp');
      expect(headers['X-Agent-Tier']).toBe('connected');
    });

    it('sends X-Agent-Host-Tool header when agentHostTool provided via runtimeIdentity', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({
        runtimeIdentity: { hostTool: 'windsurf' },
      });
      await client.get('/test');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['X-Agent-Host-Tool']).toBe('windsurf');
    });

    it('omits optional headers when not provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient();
      await client.get('/test');
      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
      expect(headers['User-Agent']).toBeUndefined();
      expect(headers['X-Agent-Id']).toBeUndefined();
    });
  });

  describe('request methods', () => {
    it('sends GET request without body', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ data: 1 }));
      const client = createJsonApiClient({ baseUrl: 'https://api.test' });
      const result = await client.get('/path');
      expect(result).toEqual({ data: 1 });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test/path',
        expect.objectContaining({
          method: 'GET',
        }),
      );
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it('sends POST request with JSON body', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ created: true }));
      const client = createJsonApiClient({ baseUrl: 'https://api.test' });
      await client.post('/items', { name: 'test' });
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(mockFetch.mock.calls[0][1].body).toBe('{"name":"test"}');
    });

    it('sends PUT request with JSON body', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ updated: true }));
      const client = createJsonApiClient({ baseUrl: 'https://api.test' });
      await client.put('/items/1', { name: 'updated' });
      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
    });

    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ deleted: true }));
      const client = createJsonApiClient({ baseUrl: 'https://api.test' });
      await client.del('/items/1');
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response with error message from body', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));
      const client = createJsonApiClient();
      await expect(client.get('/missing')).rejects.toThrow('Not found');
    });

    it('thrown error includes status code and data', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Forbidden', detail: 'no access' }, 403));
      const client = createJsonApiClient();
      try {
        await client.get('/secret');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.status).toBe(403);
        expect(err.data).toEqual({ error: 'Forbidden', detail: 'no access' });
      }
    });

    it('throws parse error when response is not JSON', async () => {
      mockFetch.mockResolvedValue(textResponse('Internal Server Error', 500));
      const client = createJsonApiClient();
      try {
        await client.get('/broken');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.status).toBe(500);
        expect(err.message).toContain('non-JSON');
      }
    });

    it('uses custom parseErrorMessage', async () => {
      mockFetch.mockResolvedValue(textResponse('fail', 502));
      const client = createJsonApiClient({
        parseErrorMessage: ({ status }) => `Custom parse error: ${status}`,
      });
      await expect(client.get('/x')).rejects.toThrow('Custom parse error: 502');
    });

    it('uses custom httpErrorMessage', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
      const client = createJsonApiClient({
        httpErrorMessage: ({ method, path, status }) => `${method} ${path} failed with ${status}`,
      });
      await expect(client.get('/y')).rejects.toThrow('GET /y failed with 400');
    });

    it('throws ApiRequestError with kind=http on non-ok response', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 422));
      const client = createJsonApiClient();
      try {
        await client.get('/bad');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        expect(err.kind).toBe('http');
        expect(err.status).toBe(422);
      }
    });

    it('throws ApiRequestError with kind=network when fetch rejects', async () => {
      const networkErr = new Error('fetch failed');
      mockFetch.mockRejectedValue(networkErr);
      const client = createJsonApiClient();
      try {
        await client.get('/down');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        expect(err.kind).toBe('network');
        expect(err.message).toBe('fetch failed');
      }
    });

    it('throws ApiRequestError with kind=timeout when AbortError occurs', async () => {
      mockFetch.mockImplementation((_url, opts) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      });

      const client = createJsonApiClient({
        timeoutMs: 50,
        maxTimeoutRetryAttempts: 0,
      });

      const promise = client.get('/slow');
      vi.advanceTimersByTime(100);
      try {
        await promise;
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        expect(err.kind).toBe('timeout');
      }
    });

    it('throws ApiRequestError on JSON parse error with http kind', async () => {
      mockFetch.mockResolvedValue(textResponse('not json', 200));
      const client = createJsonApiClient();
      try {
        await client.get('/html');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        expect(err.kind).toBe('http');
        expect(err.status).toBe(200);
      }
    });

    it('generates fallback error message for non-ok non-JSON responses with data.error missing', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ info: 'no error field' }, 418));
      const client = createJsonApiClient();
      try {
        await client.get('/teapot');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.message).toContain('GET');
        expect(err.message).toContain('/teapot');
        expect(err.message).toContain('418');
      }
    });
  });

  describe('retry behavior', () => {
    it('retries on 500 errors when maxRetryAttempts > 0', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 500))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

      const client = createJsonApiClient({ maxRetryAttempts: 1, retryDelayMs: 10 });
      const result = await client.get('/flaky');
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 429 with Retry-After header', async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        headers: new Map([['retry-after', '2']]),
        json: () => Promise.resolve({ error: 'rate limited' }),
      };
      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = createJsonApiClient({ maxRetryAttempts: 1, retryDelayMs: 10 });
      const result = await client.get('/limited');
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx errors other than 429', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'bad request' }, 400));
      const client = createJsonApiClient({ maxRetryAttempts: 3, retryDelayMs: 10 });
      await expect(client.get('/bad')).rejects.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on network errors with retryable codes', async () => {
      const connError = new Error('Connection refused');
      connError.code = 'ECONNREFUSED';
      mockFetch.mockRejectedValueOnce(connError).mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = createJsonApiClient({ maxRetryAttempts: 1, retryDelayMs: 10 });
      const result = await client.get('/down');
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-retryable network errors', async () => {
      const err = new Error('DNS failed');
      err.code = 'UNKNOWN_ERROR';
      mockFetch.mockRejectedValue(err);
      const client = createJsonApiClient({ maxRetryAttempts: 3, retryDelayMs: 10 });
      await expect(client.get('/fail')).rejects.toThrow('DNS failed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('exhausts all retry attempts before throwing', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 500));
      const client = createJsonApiClient({ maxRetryAttempts: 2, retryDelayMs: 10 });
      await expect(client.get('/failing')).rejects.toThrow();
      // Initial + 2 retries = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('timeout handling', () => {
    it('throws timeout error when request exceeds timeoutMs', async () => {
      mockFetch.mockImplementation((_url, opts) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      });

      const client = createJsonApiClient({
        timeoutMs: 100,
        maxTimeoutRetryAttempts: 0,
      });

      const promise = client.get('/slow');
      vi.advanceTimersByTime(200);
      await expect(promise).rejects.toThrow('timed out');
    });

    it('uses custom timeoutErrorMessage', async () => {
      mockFetch.mockImplementation((_url, opts) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      });

      const client = createJsonApiClient({
        timeoutMs: 50,
        maxTimeoutRetryAttempts: 0,
        timeoutErrorMessage: ({ method, path }) => `${method} ${path} timed out!`,
      });

      const promise = client.get('/slow');
      vi.advanceTimersByTime(100);
      await expect(promise).rejects.toThrow('GET /slow timed out!');
    });
  });

  describe('timeout retry behavior', () => {
    it('retries on AbortError when maxTimeoutRetryAttempts > 0 and succeeds', async () => {
      let callCount = 0;
      mockFetch.mockImplementation((_url, opts) => {
        callCount++;
        if (callCount === 1) {
          return new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              const abortErr = new Error('The operation was aborted');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          });
        }
        return Promise.resolve(jsonResponse({ ok: true }));
      });

      const client = createJsonApiClient({
        timeoutMs: 50,
        maxTimeoutRetryAttempts: 1,
        timeoutRetryDelayMs: 10,
      });

      const promise = client.get('/slow');
      vi.advanceTimersByTime(100);
      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(callCount).toBe(2);
    });

    it('exhausts timeout retries then throws timeout error', async () => {
      mockFetch.mockImplementation((_url, opts) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        });
      });

      const client = createJsonApiClient({
        timeoutMs: 50,
        maxTimeoutRetryAttempts: 2,
        timeoutRetryDelayMs: 10,
      });

      const promise = client.get('/always-slow');
      vi.advanceTimersByTime(500);
      try {
        await promise;
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        expect(err.kind).toBe('timeout');
        // 1 initial + 2 retries = 3 total
        expect(mockFetch).toHaveBeenCalledTimes(3);
      }
    });
  });

  describe('non-Error rejection from fetch', () => {
    it('wraps non-Error rejection into ApiRequestError with kind=network', async () => {
      mockFetch.mockRejectedValue('string error');
      const client = createJsonApiClient();
      try {
        await client.get('/fail');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiRequestError);
        expect(err.kind).toBe('network');
        expect(err.message).toBe('string error');
      }
    });
  });

  describe('exponential backoff for 5xx', () => {
    it('uses exponential backoff delay for server errors', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({}, 502))
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

      const client = createJsonApiClient({ maxRetryAttempts: 2, retryDelayMs: 100 });
      const result = await client.get('/server-flaky');
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('429 Retry-After header parsing', () => {
    it('uses minimum 1000ms even when Retry-After is 0', async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        headers: new Map([['retry-after', '0']]),
        json: () => Promise.resolve({ error: 'rate limited' }),
      };
      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = createJsonApiClient({ maxRetryAttempts: 1 });
      const result = await client.get('/rate-limit');
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles missing Retry-After header on 429 with 1s default', async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        headers: new Map(),
        json: () => Promise.resolve({ error: 'rate limited' }),
      };
      mockFetch
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const client = createJsonApiClient({ maxRetryAttempts: 1 });
      const result = await client.get('/rate-limit');
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('retryable network error codes', () => {
    for (const code of ['ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ETIMEDOUT']) {
      it(`retries on ${code}`, async () => {
        const networkErr = new Error(`${code} error`);
        networkErr.code = code;
        mockFetch
          .mockRejectedValueOnce(networkErr)
          .mockResolvedValueOnce(jsonResponse({ ok: true }));

        const client = createJsonApiClient({ maxRetryAttempts: 1, retryDelayMs: 10 });
        const result = await client.get('/fail');
        expect(result).toEqual({ ok: true });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    }
  });

  describe('body handling', () => {
    it('does not send body when body is null on POST', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({ baseUrl: 'https://api.test' });
      await client.post('/items');
      expect(mockFetch.mock.calls[0][1].body).toBeUndefined();
    });

    it('sends body on DELETE when provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({ baseUrl: 'https://api.test' });
      await client.del('/items/1', { reason: 'cleanup' });
      expect(mockFetch.mock.calls[0][1].body).toBe('{"reason":"cleanup"}');
    });
  });

  describe('base URL', () => {
    it('uses DEFAULT_API_URL when no baseUrl is provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient();
      await client.get('/test');
      expect(mockFetch.mock.calls[0][0]).toBe(`${DEFAULT_API_URL}/test`);
    });

    it('uses custom baseUrl when provided', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createJsonApiClient({ baseUrl: 'http://localhost:8787' });
      await client.get('/api/test');
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:8787/api/test');
    });
  });
});

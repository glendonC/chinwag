import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createJsonApiClient, DEFAULT_API_URL } from '../api-client.js';

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

  describe('DEFAULT_API_URL', () => {
    it('exports the production API URL', () => {
      expect(DEFAULT_API_URL).toBe('https://chinwag-api.glendonchin.workers.dev');
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
      expect(mockFetch).toHaveBeenCalledWith('https://api.test/path', expect.objectContaining({
        method: 'GET',
      }));
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
      mockFetch
        .mockRejectedValueOnce(connError)
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

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

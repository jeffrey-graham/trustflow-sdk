import axios from 'axios';
import {
  apiRetryDelay,
  createApiHttpClient,
  installApiRetryInterceptor,
  isMethodRetryable,
  requestMethodOf,
  shouldRetryRequest,
  toApiErrorMessage,
} from '../src/utils/http';
import { AxiosError } from 'axios';

/** The minimal error shape the retry policy inspects. */
interface HttpError {
  response?: { status?: number; statusText?: string; headers?: Record<string, string> };
  config?: { method?: string; trustflowRetry?: boolean };
  code?: string;
}

function httpError(status: number, method = 'get', extra: Partial<HttpError> = {}): HttpError {
  return { response: { status }, config: { method }, ...extra };
}

describe('requestMethodOf / isMethodRetryable', () => {
  it('reads the method off the error config, defaulting to get', () => {
    expect(requestMethodOf(httpError(500, 'post'))).toBe('post');
    expect(requestMethodOf({})).toBe('get');
  });

  it.each(['get', 'head', 'options', 'put', 'delete'])('treats %s as idempotent', (method) => {
    expect(isMethodRetryable(httpError(500, method))).toBe(true);
  });

  it.each(['post', 'patch'])('treats %s as non-idempotent', (method) => {
    expect(isMethodRetryable(httpError(500, method))).toBe(false);
  });

  it('honours the per-request trustflowRetry opt-in', () => {
    expect(
      isMethodRetryable(
        httpError(500, 'post', { config: { method: 'post', trustflowRetry: true } }),
      ),
    ).toBe(true);
  });
});

describe('shouldRetryRequest', () => {
  it.each([429, 408, 500, 502, 503, 504])('retries %p for an idempotent method', (status) => {
    expect(shouldRetryRequest(httpError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])('never retries %p', (status) => {
    expect(shouldRetryRequest(httpError(status))).toBe(false);
  });

  it('retries a transport failure with no response for an idempotent method', () => {
    expect(shouldRetryRequest({ config: { method: 'get' }, code: 'ECONNRESET' })).toBe(true);
  });

  it('does not retry a transport failure for a POST', () => {
    expect(shouldRetryRequest({ config: { method: 'post' }, code: 'ECONNRESET' })).toBe(false);
  });

  it('does not retry a POST on 5xx — a replay could duplicate the side effect', () => {
    expect(shouldRetryRequest(httpError(500, 'post'))).toBe(false);
    expect(shouldRetryRequest(httpError(429, 'post'))).toBe(false);
    expect(shouldRetryRequest(httpError(408, 'patch'))).toBe(false);
  });

  it('retries a POST on 5xx when the call opts in', () => {
    expect(
      shouldRetryRequest(
        httpError(500, 'post', { config: { method: 'post', trustflowRetry: true } }),
      ),
    ).toBe(true);
  });

  it('never retries a cancelled request for either idempotent or non-idempotent methods (#610)', () => {
    const canceledGet = new axios.CanceledError('Request aborted by caller');
    (canceledGet as unknown as { config: Record<string, unknown> }).config = { method: 'get' };
    expect(shouldRetryRequest(canceledGet)).toBe(false);

    const canceledPost = new axios.CanceledError('Request aborted by caller');
    (canceledPost as unknown as { config: Record<string, unknown> }).config = {
      method: 'post',
      trustflowRetry: true,
    };
    expect(shouldRetryRequest(canceledPost)).toBe(false);

    expect(shouldRetryRequest({ code: 'ERR_CANCELED', config: { method: 'get' } })).toBe(false);
  });
});

describe('apiRetryDelay', () => {
  const config = { retries: 3, retryDelayMs: 100, maxRetryDelayMs: 250, jitter: false };

  it('grows exponentially and caps at maxRetryDelayMs', () => {
    expect(apiRetryDelay(1, httpError(503), config)).toBe(100);
    expect(apiRetryDelay(2, httpError(503), config)).toBe(200);
    expect(apiRetryDelay(3, httpError(503), config)).toBe(250);
  });

  it('jitters within [delay / 2, delay] when enabled', () => {
    const jittered = { ...config, jitter: true };
    for (let i = 0; i < 100; i++) {
      const delay = apiRetryDelay(1, httpError(503), jittered);
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(100);
    }
  });

  it('prefers a Retry-After hint, still capped by maxRetryDelayMs', () => {
    const throttled = httpError(429, 'get', {
      response: { status: 429, headers: { 'retry-after': '1' } },
    });
    expect(apiRetryDelay(1, throttled, { ...config, maxRetryDelayMs: 10_000 })).toBe(1000);

    const huge = httpError(429, 'get', {
      response: { status: 429, headers: { 'retry-after': '60' } },
    });
    expect(apiRetryDelay(1, huge, config)).toBe(250);
  });
});

describe('createApiHttpClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configures the axios instance with default headers and a timeout', () => {
    const instance = { get: jest.fn(), interceptors: { response: { use: jest.fn() } } };
    const create = jest.spyOn(axios, 'create').mockReturnValue(instance as never);

    expect(createApiHttpClient({ baseURL: 'https://api.trustflow.xyz', apiKey: 'token' })).toBe(
      instance as never,
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://api.trustflow.xyz',
        timeout: 10_000,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        }),
      }),
    );
  });

  it('honours timeoutMs and additionalHeaders', () => {
    const instance = { interceptors: { response: { use: jest.fn() } } };
    const create = jest.spyOn(axios, 'create').mockReturnValue(instance as never);

    createApiHttpClient({
      baseURL: 'https://api.trustflow.xyz',
      timeoutMs: 1234,
      additionalHeaders: { 'X-Trace': 'abc' },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 1234,
        headers: expect.objectContaining({ 'X-Trace': 'abc' }),
      }),
    );
  });

  it('installs exactly one retry interceptor', () => {
    const use = jest.fn();
    jest.spyOn(axios, 'create').mockReturnValue({ interceptors: { response: { use } } } as never);

    createApiHttpClient({ baseURL: 'https://api.trustflow.xyz' });

    // The retry interceptor registers no onFulfilled handler (`undefined`
    // first arg); the response-logging interceptor registers two handlers.
    // Exactly one `undefined`-first-arg registration means exactly one retry
    // interceptor.
    expect(use).toHaveBeenCalledTimes(2);
    expect(use).toHaveBeenCalledWith(undefined, expect.any(Function));
    expect(use.mock.calls.filter(([onFulfilled]) => onFulfilled === undefined)).toHaveLength(1);
  });
});

describe('installApiRetryInterceptor', () => {
  const BUDGET = { retries: 3, retryDelayMs: 1, maxRetryDelayMs: 1, jitter: false } as const;

  interface Rejection {
    response?: { status?: number };
    config?: Record<string, unknown>;
    code?: string;
  }

  /**
   * Installs the interceptor on a fake axios instance and returns a function
   * that feeds it a failure.
   *
   * The fake `request` routes its own rejections back through the interceptor,
   * which is what real axios does — `instance.request(config)` re-runs the
   * response interceptors, and it is that recursion that drives the retry loop.
   */
  function harness(budget: Partial<typeof BUDGET> = {}) {
    type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };
    const queue: Outcome[] = [];
    let onRejected: ((error: unknown) => Promise<unknown>) | undefined;

    const request = jest.fn((config: Record<string, unknown>) => {
      const next: Outcome =
        queue.length > 0
          ? (queue.shift() as Outcome)
          : { ok: true, value: { status: 200, data: 'ok' } };
      if (next.ok) return Promise.resolve(next.value);
      // Real axios routes a replayed request back through the response
      // interceptors with the same config object, and it is that recursion that
      // drives the retry loop.
      const error = next.error as { config?: unknown };
      if (error && typeof error === 'object') {
        // axios attaches the live config to every rejection, including the
        // replayed ones, which is what carries the attempt counter forward.
        error.config = config;
      }
      return Promise.reject(next.error).catch((e: unknown) =>
        (onRejected as (e: unknown) => Promise<unknown>)(e),
      );
    });

    const shim = {
      interceptors: {
        response: {
          use: (_onFulfilled: unknown, onRejectedHandler: (e: unknown) => Promise<unknown>) => {
            onRejected = onRejectedHandler;
          },
        },
      },
      request,
    };

    installApiRetryInterceptor(shim as unknown as ReturnType<typeof axios.create>, {
      ...BUDGET,
      ...budget,
    });

    return {
      request,
      /** Queues a successful outcome for the next `request` call. */
      enqueueOk: (value: unknown) => queue.push({ ok: true, value }),
      /** Queues a failure for the next `request` call. */
      enqueueError: (error: unknown) => queue.push({ ok: false, error }),
      fail: (error: unknown) => (onRejected as (e: unknown) => Promise<unknown>)(error),
    };
  }

  /** A 503 rejection with its own fresh config, as axios would attach. */
  const serverError = (method = 'get'): Rejection => ({
    response: { status: 503 },
    config: { method },
  });

  it('replays an idempotent request that failed with 503 and resolves the retry', async () => {
    const { fail, request } = harness();

    await expect(fail(serverError())).resolves.toEqual({ status: 200, data: 'ok' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'get', __trustflowAttempts: 1 });
  });

  it('gives up after the configured number of retries', async () => {
    const { fail, request, enqueueError } = harness({ retries: 2 });

    // The failure handed to `fail` is attempt 1. Replay 1 and replay 2 fail
    // too, and the budget of 2 retries is then spent.
    enqueueError(serverError());
    enqueueError(serverError());

    await expect(fail(serverError())).rejects.toMatchObject({
      response: { status: 503 },
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('succeeds on a later attempt when the server recovers', async () => {
    const { fail, request, enqueueOk } = harness({ retries: 3 });
    // The failure handed to `fail` is the first attempt; the queued success is
    // the replay, so the call resolves on its second attempt.
    enqueueOk({ status: 200, data: 'recovered' });

    await expect(fail(serverError())).resolves.toEqual({ status: 200, data: 'recovered' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].__trustflowAttempts).toBe(1);
  });

  it('rethrows immediately for a 4xx without spending the budget', async () => {
    const { fail, request } = harness();
    const error = { response: { status: 404 }, config: { method: 'get' } };

    await expect(fail(error)).rejects.toBe(error);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not replay a POST on 500', async () => {
    const { fail, request } = harness();
    const error = { response: { status: 500 }, config: { method: 'post' } };

    await expect(fail(error)).rejects.toBe(error);
    expect(request).not.toHaveBeenCalled();
  });

  it('replays a POST on 500 when the call opted in', async () => {
    const { fail, request } = harness();
    const config = { method: 'post', trustflowRetry: true };

    await expect(fail({ response: { status: 500 }, config })).resolves.toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('replays a transport failure (no response) for an idempotent method', async () => {
    const { fail, request } = harness();
    const config = { method: 'get' };

    await expect(fail({ code: 'ECONNRESET', config })).resolves.toBeDefined();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rethrows a cancelled GET request immediately without sleeping or replaying (#610)', async () => {
    const { fail, request } = harness({ retryDelayMs: 5000, maxRetryDelayMs: 5000 });
    const canceled = new axios.CanceledError('aborted');
    (canceled as unknown as { config: Record<string, unknown> }).config = { method: 'get' };

    const start = Date.now();
    await expect(fail(canceled)).rejects.toBe(canceled);
    expect(Date.now() - start).toBeLessThan(200);
    expect(request).not.toHaveBeenCalled();
  });

  it('rethrows when the failure carries no request config', async () => {
    const { fail, request } = harness();
    const error = { message: 'bad baseURL' };

    await expect(fail(error)).rejects.toBe(error);
    expect(request).not.toHaveBeenCalled();
  });

  it('increments the attempt count across replays of the same config', async () => {
    const { fail, request, enqueueError, enqueueOk } = harness({ retries: 3 });
    enqueueError(serverError());
    enqueueOk({ status: 200 });

    await fail(serverError());

    // axios reuses one config object across replays, so the counter it carries
    // is the running total: 1 after the first retry, 2 after the second.
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
    expect(request.mock.calls[1][0].__trustflowAttempts).toBe(2);
  });
});

describe('toApiErrorMessage', () => {
  it('formats axios errors with a status', () => {
    const error = new AxiosError('failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 503,
      statusText: 'Service Unavailable',
    });

    expect(toApiErrorMessage(error)).toBe('HTTP 503: Service Unavailable');
  });

  it('falls back to the message for an axios error with no response', () => {
    const error = new AxiosError('socket hang up', 'ECONNRESET');
    expect(toApiErrorMessage(error)).toBe('Network error: socket hang up');
  });

  it('formats network errors and unknown values', () => {
    expect(toApiErrorMessage(new Error('timeout'))).toBe('Network error: timeout');
    expect(toApiErrorMessage('boom')).toBe('Network error: boom');
  });
});

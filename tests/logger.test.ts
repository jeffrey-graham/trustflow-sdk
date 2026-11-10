import { SDKLogger, createLogger, type Logger } from '../src/utils/logger';

describe('SDKLogger level filtering', () => {
  let debugSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('only emits at or above the minimum level (default error)', () => {
    const log = new SDKLogger();
    expect(log.getMinLevel()).toBe('error');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('emits debug when minLevel is debug, and setMinLevel updates at runtime', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.debug('d');
    expect(debugSpy).toHaveBeenCalledTimes(1);
    log.setMinLevel('silent');
    log.error('e');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('delegates to an injected application logger', () => {
    const calls: Array<[string, unknown?]> = [];
    const appLogger: Logger = {
      debug: (m, c) => void calls.push(['debug', c ?? m]),
      info: (m, c) => void calls.push(['info', c ?? m]),
      warn: (m, c) => void calls.push(['warn', c ?? m]),
      error: (m, c) => void calls.push(['error', c ?? m]),
    };
    const log = new SDKLogger({ minLevel: 'debug', logger: appLogger });
    log.debug('hello', { a: 1 });
    log.error('boom');
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('debug');
    // Nothing should go to the real console when a custom logger is set
    expect(debugSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('redacts secrets (Authorization, api keys, tokens) from context', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.info('request', {
      Authorization: 'Bearer secret',
      apiKey: 'super-secret',
      privateKey: 'S...',
      key: 'raw-key',
      nested: { token: 'abc', secretKey: 'xyz', safe: 'ok' },
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const context = infoSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(context['Authorization']).toBe('[REDACTED]');
    expect(context['apiKey']).toBe('[REDACTED]');
    expect(context['privateKey']).toBe('[REDACTED]');
    expect(context['key']).toBe('[REDACTED]');
    expect((context['nested'] as Record<string, unknown>)['token']).toBe('[REDACTED]');
    expect((context['nested'] as Record<string, unknown>)['secretKey']).toBe('[REDACTED]');
    expect((context['nested'] as Record<string, unknown>)['safe']).toBe('ok');
  });

  it('preserves non-secret fields containing "key" such as publicKey (#581)', () => {
    const log = new SDKLogger({ minLevel: 'debug' });
    log.info('signer check', {
      publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      pubKey: 'GABC...',
      signerPublicKey: 'GDEF...',
      keypair: 'kp-1',
      idempotencyKey: 'idem-123',
      nested: {
        public_key: 'GXYZ...',
        api_key: 'secret-api-key',
      },
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const context = infoSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(context['publicKey']).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    expect(context['pubKey']).toBe('GABC...');
    expect(context['signerPublicKey']).toBe('GDEF...');
    expect(context['keypair']).toBe('kp-1');
    expect(context['idempotencyKey']).toBe('idem-123');
    expect((context['nested'] as Record<string, unknown>)['public_key']).toBe('GXYZ...');
    expect((context['nested'] as Record<string, unknown>)['api_key']).toBe('[REDACTED]');
  });

  it('emits structured JSON with timestamp/scope/message/context', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const log = new SDKLogger({ minLevel: 'info', json: true, prefix: 'TestScope' });
    log.debug('suppressed');
    log.info('hello', { foo: 'bar', password: 'secret' });
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('suppressed'));
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(infoSpy.mock.calls[0][0] as string);
    expect(payload.scope).toBe('TestScope');
    expect(payload.level).toBe('INFO');
    expect(payload.message).toBe('hello');
    expect(payload.timestamp).toBeDefined();
    expect(payload.context.foo).toBe('bar');
    expect(payload.context.password).toBe('[REDACTED]');
    logSpy.mockRestore();
  });

  it('does not touch context when the level is disabled (cheap)', () => {
    const log = new SDKLogger({ minLevel: 'error' });
    let accessed = false;
    const context = {};
    Object.defineProperty(context, 'expensive', {
      get() {
        accessed = true;
        return 'x';
      },
    });
    log.debug('nope', context);
    expect(accessed).toBe(false);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('createLogger sets a custom prefix', () => {
    const log = createLogger('MyApp', { minLevel: 'info' });
    log.info('hi');
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0][0])).toContain('[MyApp]');
  });
});

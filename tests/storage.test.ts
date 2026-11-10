import axios from 'axios';
import { IPFSStorage } from '../src/storage/ipfs';
import type { EncryptedData } from '../src';
import type { EncryptedData as StorageEncryptedData } from '../src/storage';
import { createApiHttpClient } from '../src/utils/http';
import { TrustFlowError } from '../src/errors';

const mockHttpPost = jest.fn();

jest.mock('../src/utils/http', () => ({
  createApiHttpClient: jest.fn(() => ({ post: mockHttpPost })),
  toApiErrorMessage: (error: unknown) => {
    if (error instanceof Error) {
      return `Network error: ${error.message}`;
    }
    return `Network error: ${String(error)}`;
  },
}));

describe('IPFSStorage.upload', () => {
  beforeEach(() => {
    mockHttpPost.mockReset();
    jest.mocked(createApiHttpClient).mockClear();
  });

  it('rejects an empty file', async () => {
    const storage = new IPFSStorage();
    const result = await storage.upload(Buffer.alloc(0));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/non-empty/);
    }
    expect(mockHttpPost).not.toHaveBeenCalled();
  });

  it('uploads a file and returns the cid and gateway url', async () => {
    mockHttpPost.mockResolvedValueOnce({ data: { cid: 'bafy123' } });

    const storage = new IPFSStorage();
    const result = await storage.upload(Buffer.from('hello world'), { filename: 'hello.txt' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.cid).toBe('bafy123');
      expect(result.data.url).toBe('https://w3s.link/ipfs/bafy123');
    }
  });

  it('uses a custom apiUrl, apiKey, and gatewayUrl when configured', async () => {
    mockHttpPost.mockResolvedValueOnce({ data: { cid: 'bafy456' } });

    const storage = new IPFSStorage({
      apiUrl: 'https://custom-ipfs.example.com/upload',
      apiKey: 'test-key',
      gatewayUrl: 'https://custom-gateway.example.com/ipfs',
    });
    const result = await storage.upload(Buffer.from('data'));

    expect(jest.mocked(createApiHttpClient)).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://custom-ipfs.example.com/upload',
        apiKey: 'test-key',
      }),
    );
    expect(mockHttpPost.mock.calls[0][0]).toBe('');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.url).toBe('https://custom-gateway.example.com/ipfs/bafy456');
    }
  });

  it('uses the same normalized URL for upload and resolve with a custom gateway', async () => {
    const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
    mockHttpPost.mockResolvedValueOnce({ data: { cid } });
    const getSpy = jest.spyOn(axios, 'get').mockResolvedValueOnce({
      headers: { 'content-type': 'application/json' },
      data: '{"hello":"world"}',
    });

    try {
      const storage = new IPFSStorage({
        gatewayUrl: 'https://my-gateway.example///',
        fallbackGateways: [],
      });
      const uploaded = await storage.upload(Buffer.from('data'));
      expect(uploaded.ok).toBe(true);
      if (!uploaded.ok) throw new Error('Expected upload to succeed');

      expect(uploaded.data.url).toBe(`https://my-gateway.example/ipfs/${cid}`);
      await expect(storage.resolve(cid)).resolves.toEqual({ hello: 'world' });
      expect(getSpy).toHaveBeenCalledWith(
        uploaded.data.url,
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
    } finally {
      getSpy.mockRestore();
    }
  });

  it('forwards content type and filename headers', async () => {
    mockHttpPost.mockResolvedValueOnce({ data: { cid: 'bafy789' } });

    const storage = new IPFSStorage();
    await storage.upload(Buffer.from('data'), {
      filename: 'doc.pdf',
      contentType: 'application/pdf',
    });

    expect(mockHttpPost).toHaveBeenCalledWith('', expect.anything(), {
      headers: { 'Content-Type': 'application/pdf', 'X-Name': 'doc.pdf' },
    });
  });

  it('requests the exact configured apiUrl, including a query string', async () => {
    const axios = jest.requireActual('axios');
    const apiUrl = 'https://host.example/upload?token=abc';
    new IPFSStorage({ apiUrl });
    const { baseURL } = jest.mocked(createApiHttpClient).mock.calls[0][0];
    expect(axios.getUri({ baseURL, url: '' })).toBe(apiUrl);

    new IPFSStorage();
    const defaults = jest.mocked(createApiHttpClient).mock.calls[1][0];
    expect(axios.getUri({ baseURL: defaults.baseURL, url: '' })).toBe(
      'https://api.web3.storage/upload',
    );
  });

  it('accepts a File and uses its name and type as defaults', async () => {
    mockHttpPost.mockResolvedValueOnce({ data: { cid: 'bafyfile' } });
    const storage = new IPFSStorage();
    const result = await storage.upload(new File(['hello'], 'note.txt', { type: 'text/plain' }));

    expect(result.ok).toBe(true);
    const [, body, config] = mockHttpPost.mock.calls[0];
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.byteLength).toBe(5);
    expect(config.headers).toEqual({ 'Content-Type': 'text/plain', 'X-Name': 'note.txt' });
  });

  it('accepts a Blob and lets options override its type', async () => {
    mockHttpPost.mockResolvedValue({ data: { cid: 'bafyblob' } });
    const storage = new IPFSStorage();
    await storage.upload(new Blob(['abc'], { type: 'text/plain' }));
    expect(mockHttpPost.mock.calls[0][2].headers).toEqual({ 'Content-Type': 'text/plain' });

    await storage.upload(new Blob(['abc'], { type: 'text/plain' }), {
      contentType: 'application/pdf',
    });
    expect(mockHttpPost.mock.calls[1][2].headers['Content-Type']).toBe('application/pdf');
  });

  it('accepts an ArrayBuffer and rejects empty Blob and ArrayBuffer inputs', async () => {
    mockHttpPost.mockResolvedValueOnce({ data: { cid: 'bafybuf' } });
    const storage = new IPFSStorage();
    const ok = await storage.upload(new Uint8Array([1, 2, 3]).buffer);
    expect(ok.ok).toBe(true);
    expect(mockHttpPost.mock.calls[0][1]).toBeInstanceOf(Uint8Array);

    const emptyBlob = await storage.upload(new Blob([]));
    const emptyBuf = await storage.upload(new ArrayBuffer(0));
    expect(emptyBlob.ok).toBe(false);
    expect(emptyBuf.ok).toBe(false);
    expect(mockHttpPost).toHaveBeenCalledTimes(1);
  });

  it('creates the HTTP client once and reuses it across uploads', async () => {
    mockHttpPost.mockResolvedValue({ data: { cid: 'bafy1' } });
    const storage = new IPFSStorage();
    await storage.upload(Buffer.from('a'));
    await storage.upload(Buffer.from('b'));
    expect(jest.mocked(createApiHttpClient)).toHaveBeenCalledTimes(1);
    expect(mockHttpPost).toHaveBeenCalledTimes(2);
  });

  it('returns an error when the response has no cid', async () => {
    mockHttpPost.mockResolvedValueOnce({ data: {} });

    const storage = new IPFSStorage();
    const result = await storage.upload(Buffer.from('data'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/CID/);
    }
  });

  it('returns a mapped error when the upload request fails', async () => {
    mockHttpPost.mockRejectedValueOnce(new Error('HTTP 500: Internal Server Error'));

    const storage = new IPFSStorage();
    const result = await storage.upload(Buffer.from('data'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Network error/);
    }
  });

  it('exports EncryptedData through the public entrypoints (#554)', () => {
    const payload: EncryptedData = {
      iv: 'aXY=',
      data: 'ZGF0YQ==',
      tag: 'dGFn',
    };
    const storagePayload: StorageEncryptedData = payload;
    expect(storagePayload.iv).toBe('aXY=');
    expect(storagePayload.data).toBe('ZGF0YQ==');
    expect(storagePayload.tag).toBe('dGFn');
  });

  it('distinguishes abortSignal cancellation from network failure for pre-aborted and mid-request aborts (#608)', async () => {
    const storage = new IPFSStorage();

    // 1. Pre-aborted signal
    const preController = new AbortController();
    preController.abort();
    const preResult = await storage.upload(Buffer.from('data'), {
      abortSignal: preController.signal,
    });
    expect(preResult).toEqual({
      ok: false,
      error: 'Request aborted',
      code: 'ABORTED',
      aborted: true,
    });
    expect(mockHttpPost).not.toHaveBeenCalled();

    // 2. Aborted mid-request
    const midController = new AbortController();
    mockHttpPost.mockImplementationOnce(async (_url: string, _body: unknown, cfg: { signal?: AbortSignal }) => {
      expect(cfg.signal).toBe(midController.signal);
      midController.abort();
      throw new axios.CanceledError('canceled');
    });

    const midResult = await storage.upload(Buffer.from('data'), {
      abortSignal: midController.signal,
    });
    expect(midResult).toEqual({
      ok: false,
      error: 'Request aborted',
      code: 'ABORTED',
      aborted: true,
    });
  });
});

describe('IPFSStorage encryption', () => {
  it('round-trips authenticated encryption', () => {
    const storage = new IPFSStorage();
    const key = Buffer.alloc(32, 9);
    const encrypted = storage.encrypt('secret payload', key);
    expect(storage.decrypt(encrypted, key).toString()).toBe('secret payload');
  });

  it('reports encryption and decryption failures with specific codes', () => {
    const storage = new IPFSStorage();
    expect(() => storage.encrypt('data', Buffer.alloc(31))).toThrow(TrustFlowError);
    try {
      storage.encrypt('data', Buffer.alloc(31));
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(() => storage.decrypt({ iv: 'bad', data: 'bad', tag: 'bad' }, Buffer.alloc(31))).toThrow(
      TrustFlowError,
    );
    try {
      storage.decrypt({ iv: 'bad', data: 'bad', tag: 'bad' }, Buffer.alloc(31));
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    const encrypted = storage.encrypt('data', Buffer.alloc(32, 1));
    encrypted.tag = Buffer.from('corrupt').toString('base64');
    try {
      storage.decrypt(encrypted, Buffer.alloc(32, 1));
    } catch (error) {
      expect(error).toMatchObject({ code: 'DECRYPTION_ERROR' });
    }
    expect(() => storage.encrypt(Symbol() as unknown as string, Buffer.alloc(32, 1))).toThrow(
      TrustFlowError,
    );
  });
});

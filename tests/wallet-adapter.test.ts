import { createFreighterAdapter } from '../src/wallet/adapter';
import type { WalletAdapter } from '../src/wallet/types';
import { MockWalletAdapter } from '../src/testing';
import { TrustFlowError } from '../src/errors';

const PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function installFreighter(provider: Record<string, unknown>): void {
  (globalThis as any).window = { freighter: provider };
}

afterEach(() => {
  delete (globalThis as any).window;
});

describe('createFreighterAdapter (#435)', () => {
  it('satisfies the WalletAdapter interface', () => {
    const adapter: WalletAdapter = createFreighterAdapter();
    expect(adapter.type).toBe('freighter');
  });

  it('reports unavailable and throws UNAUTHORIZED when Freighter is not installed', async () => {
    const adapter = createFreighterAdapter();

    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.sign('xdr', 'TESTNET')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(adapter.signMessage('hello')).rejects.toBeInstanceOf(TrustFlowError);
  });

  it('delegates connect, sign and signMessage to the injected extension', async () => {
    const signTransaction = jest.fn().mockResolvedValue({ signedXDR: 'signed_xdr' });
    installFreighter({
      getPublicKey: jest.fn().mockResolvedValue(PUBLIC_KEY),
      getNetwork: jest.fn().mockResolvedValue('TESTNET'),
      signTransaction,
      signMessage: jest.fn().mockResolvedValue('sig'),
    });
    const adapter = createFreighterAdapter();

    await expect(adapter.isAvailable()).resolves.toBe(true);
    await expect(adapter.connect()).resolves.toEqual({
      type: 'freighter',
      publicKey: PUBLIC_KEY,
      network: 'TESTNET',
    });
    await expect(adapter.sign('xdr', 'TESTNET')).resolves.toBe('signed_xdr');
    expect(signTransaction).toHaveBeenCalledWith('xdr', { network: 'TESTNET' });
    await expect(adapter.signMessage('hello')).resolves.toBe('sig');
  });

  it('wraps user rejections and generic extension errors in TrustFlowError for sign and signMessage (#601)', async () => {
    installFreighter({
      getPublicKey: jest.fn().mockResolvedValue(PUBLIC_KEY),
      getNetwork: jest.fn().mockResolvedValue('TESTNET'),
      signTransaction: jest
        .fn()
        .mockRejectedValueOnce(new Error('User declined access'))
        .mockRejectedValueOnce(new Error('Hardware ledger disconnected')),
      signMessage: jest
        .fn()
        .mockRejectedValueOnce({ code: -4, message: 'User rejected request' })
        .mockRejectedValueOnce('unexpected extension crash'),
    });
    const adapter = createFreighterAdapter();

    await expect(adapter.sign('xdr', 'TESTNET')).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'USER_REJECTED',
    });
    await expect(adapter.sign('xdr', 'TESTNET')).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'SIGNING_ERROR',
    });

    await expect(adapter.signMessage('hello')).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'USER_REJECTED',
    });
    await expect(adapter.signMessage('hello')).rejects.toMatchObject({
      name: 'TrustFlowError',
      code: 'SIGNING_ERROR',
    });
  });
});

describe('MockWalletAdapter.asWalletAdapter (#435)', () => {
  it('exposes the mock through the WalletAdapter interface and shares its state', async () => {
    const mock = new MockWalletAdapter(PUBLIC_KEY);
    const adapter: WalletAdapter = mock.asWalletAdapter();

    await expect(adapter.isAvailable()).resolves.toBe(true);
    await expect(adapter.connect()).resolves.toEqual({
      type: 'freighter',
      publicKey: PUBLIC_KEY,
      network: 'TESTNET',
    });
    await expect(adapter.sign('xdr', 'TESTNET')).resolves.toBe('xdr');
    await expect(adapter.signMessage('hi')).resolves.toBe('mock_sig_hi');

    await adapter.disconnect();
    await expect(adapter.isAvailable()).resolves.toBe(false);
    expect(mock.connected).toBe(false);
  });
});

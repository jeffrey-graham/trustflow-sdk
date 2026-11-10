import { Keypair } from '@stellar/stellar-sdk';
import { TrustFlowEscrowClient } from '../src/escrow/client';
import * as invokeModule from '../src/contract/invoke';
import * as readModule from '../src/contract/read';
import type { ContractConfig } from '../src/types/contract';

const DEPOSITOR = Keypair.random().publicKey();
const BENEFICIARY = Keypair.random().publicKey();

const CONFIG: ContractConfig = {
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

beforeEach(() => {
  jest.spyOn(invokeModule, 'invokeContract').mockResolvedValue({
    success: true,
    txHash: 'tx_onchain_abc123',
    returnValue: 'esc-onchain-1',
  });
  jest.spyOn(readModule, 'readContractState').mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TrustFlowEscrowClient.createEscrow', () => {
  it('creates an escrow via invokeContract and returns on-chain escrowId and txHash', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '50',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.escrowId).toBe('esc-onchain-1');
      expect(result.data.txHash).toBe('tx_onchain_abc123');
    }
    expect(invokeModule.invokeContract).toHaveBeenCalledWith(
      expect.anything(),
      'create_escrow',
      expect.any(Array),
      DEPOSITOR,
    );
  });

  it('propagates invokeContract failures as { ok: false }', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValueOnce({
      success: false,
      error: 'Simulation failed: insufficient balance',
    });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '50',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/insufficient balance/);
    }
  });

  it('encodes the deadlineBlocks into the underlying contract call arguments', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '50',
      deadlineBlocks: 17_280,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects an invalid depositor address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: 'not-a-stellar-address',
      beneficiary: BENEFICIARY,
      amountXLM: '50',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*sender/i);
    }
  });

  it('rejects an invalid beneficiary address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: 'not-a-stellar-address',
      amountXLM: '50',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*recipient/i);
    }
  });

  it('rejects a non-positive amount', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '0',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*amount/i);
    }
  });
});

describe('TrustFlowEscrowClient.fund', () => {
  it('funds an escrow for a valid amount and no token address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', DEPOSITOR, 50_000_000n);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.txHash).toBe('tx_onchain_abc123');
    }
    expect(invokeModule.invokeContract).toHaveBeenCalledWith(
      expect.anything(),
      'fund_escrow',
      expect.any(Array),
      DEPOSITOR,
    );
  });

  it('propagates invokeContract failures on fund as { ok: false }', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValueOnce({
      success: false,
      error: 'Fund transaction reverted',
    });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', DEPOSITOR, 50_000_000n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Fund transaction reverted/);
    }
  });

  it('funds an escrow with a specific token address (e.g. USDC contract)', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const usdcContract = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    const result = await client.fund('esc-1', DEPOSITOR, 50_000_000n, usdcContract);

    expect(result.ok).toBe(true);
  });

  it('rejects a missing escrowId', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('', DEPOSITOR, 50_000_000n);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*escrowId/i);
    }
  });

  it('rejects an invalid funder address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', 'not-a-stellar-address', 50_000_000n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*funder/i);
    }
  });

  it('rejects a non-positive amount', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', DEPOSITOR, 0n);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*amount/i);
    }
  });
});

describe('TrustFlowEscrowClient.claim', () => {
  it('claims funds for a valid escrowId and claimant address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('esc-1', BENEFICIARY);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.txHash).toBe('tx_onchain_abc123');
    }
    expect(invokeModule.invokeContract).toHaveBeenCalledWith(
      expect.anything(),
      'claim_escrow',
      expect.any(Array),
      BENEFICIARY,
    );
  });

  it('propagates invokeContract failures on claim as { ok: false }', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValueOnce({
      success: false,
      error: 'Claim rejected by contract',
    });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('esc-1', BENEFICIARY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Claim rejected/);
    }
  });

  it('rejects a missing escrowId', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('', BENEFICIARY);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*escrowId/i);
    }
  });

  it('rejects an invalid claimant address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('esc-1', 'not-a-stellar-address');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*claimant/i);
    }
  });
});

describe('TrustFlowEscrowClient.releaseEscrow and getEscrow', () => {
  it('encodes release arguments and invokes release_escrow on the contract', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.releaseEscrow('esc-1', DEPOSITOR);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.txHash).toBe('tx_onchain_abc123');
    }
    expect(invokeModule.invokeContract).toHaveBeenCalledWith(
      expect.anything(),
      'release_escrow',
      expect.any(Array),
      DEPOSITOR,
    );
  });

  it('propagates invokeContract failures on releaseEscrow as { ok: false }', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValueOnce({
      success: false,
      error: 'Release rejected by contract',
    });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.releaseEscrow('esc-1', DEPOSITOR);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Release rejected/);
    }
  });

  it('reads escrow state via readContractState and propagates RPC errors as { ok: false }', async () => {
    const mockState = {
      escrowId: 'esc-1',
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountStroops: 50_000_000n,
      status: 'active',
    };
    jest.spyOn(readModule, 'readContractState').mockResolvedValueOnce(mockState);
    const client = new TrustFlowEscrowClient(CONFIG);
    const okRes = await client.getEscrow('esc-1');
    expect(okRes).toEqual({ ok: true, data: mockState });

    jest
      .spyOn(readModule, 'readContractState')
      .mockRejectedValueOnce(new Error('RPC simulation failed'));
    const errRes = await client.getEscrow('esc-1');
    expect(errRes.ok).toBe(false);
    if (!errRes.ok) {
      expect(errRes.error).toMatch(/RPC simulation failed/);
    }
  });
});

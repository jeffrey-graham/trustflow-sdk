import { disputeEscrow } from '../src/escrow/dispute';
import { buildDisputeArgs } from '../src/contract/build';
import * as invokeModule from '../src/contract/invoke';
import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import { TrustFlowClient } from '../src/client';
import { TrustFlowError } from '../src/errors';
import { Keypair } from '@stellar/stellar-sdk';

const CALLER = Keypair.random().publicKey();

describe('disputeEscrow', () => {
  const client = new TrustFlowClient({ contractId: 'CONTRACT123', network: 'TESTNET' });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('invokes dispute_escrow on the contract and returns the real txHash', async () => {
    const spy = jest
      .spyOn(invokeModule, 'invokeContract')
      .mockResolvedValue({ success: true, txHash: 'tx_dispute_onchain_abc123' });

    const txHash = await disputeEscrow(client, {
      escrowId: 'esc-1',
      caller: CALLER,
      reason: 'Goods not delivered as described.',
    });

    expect(txHash).toBe('tx_dispute_onchain_abc123');
    expect(spy).toHaveBeenCalledWith(
      client,
      'dispute_escrow',
      buildDisputeArgs('esc-1', CALLER, 'Goods not delivered as described.'),
      CALLER,
    );
  });

  it('propagates contract invocation failures as TrustFlowError', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValue({
      success: false,
      error: 'Contract simulation reverted',
      code: 'SIMULATION_ERROR',
    });

    await expect(
      disputeEscrow(client, {
        escrowId: 'esc-1',
        caller: CALLER,
        reason: 'Goods not delivered as described.',
      }),
    ).rejects.toThrow(TrustFlowError);
  });

  it('throws when escrowId is missing', async () => {
    await expect(
      disputeEscrow(client, { escrowId: '', caller: CALLER, reason: 'reason' }),
    ).rejects.toThrow(/escrowId/);
  });

  it('throws when caller is missing', async () => {
    await expect(
      disputeEscrow(client, { escrowId: 'esc-1', caller: '', reason: 'reason' }),
    ).rejects.toThrow(/dispute/);
  });

  it('throws when reason is missing', async () => {
    await expect(
      disputeEscrow(client, { escrowId: 'esc-1', caller: CALLER, reason: '  ' }),
    ).rejects.toThrow(/reason/);
  });

  it('encodes escrowId, caller, and reason into contract call arguments', () => {
    const args = buildDisputeArgs('esc-1', CALLER, 'Goods not delivered');
    expect(args).toHaveLength(3);
    expect(args[0]).toEqual(nativeToScVal('esc-1', { type: 'string' }));
    expect(args[1]).toEqual(new Address(CALLER).toScVal());
    expect(args[2]).toEqual(nativeToScVal('Goods not delivered', { type: 'string' }));
  });
});

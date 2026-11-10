import { Keypair } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../src/client';
import { buildReleaseArgs } from '../src/contract/build';
import * as invokeModule from '../src/contract/invoke';
import { releaseEscrow } from '../src/escrow/release';
import { TrustFlowError } from '../src/errors';
import type { ReleaseEscrowParams } from '../src/types';

const CALLER = Keypair.random().publicKey();
const client = {} as TrustFlowClient;

describe('releaseEscrow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encodes release arguments and invokes release_escrow on the contract', async () => {
    const spy = jest
      .spyOn(invokeModule, 'invokeContract')
      .mockResolvedValue({ success: true, txHash: 'tx_release_onchain_999' });

    const params: ReleaseEscrowParams = {
      escrowId: 'escrow-1',
      caller: CALLER,
    };

    const txId = await releaseEscrow(client, params);

    expect(txId).toBe('tx_release_onchain_999');
    expect(spy).toHaveBeenCalledWith(
      client,
      'release_escrow',
      buildReleaseArgs('escrow-1', CALLER),
      CALLER,
    );
  });

  it('rejects with TrustFlowError when invokeContract fails', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValue({
      success: false,
      error: 'Simulation failed: caller not authorized',
      code: 'SIMULATION_ERROR',
    });

    await expect(
      releaseEscrow(client, { escrowId: 'escrow-1', caller: CALLER }),
    ).rejects.toMatchObject({ code: 'SIMULATION_ERROR' });
  });

  it('rejects a missing escrowId with a validation error', async () => {
    const promise = releaseEscrow(client, { escrowId: '', caller: CALLER });

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a missing caller with an unauthorized error', async () => {
    const promise = releaseEscrow(client, { escrowId: 'escrow-1', caller: '' });

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

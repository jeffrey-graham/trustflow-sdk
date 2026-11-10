import type { TrustFlowClient } from '../client';
import type { ReleaseEscrowParams } from '../types';
import { TrustFlowError } from '../errors';
import { buildReleaseArgs } from '../contract/build';
import { invokeContract } from '../contract/invoke';
import { logger } from '../utils/logger';

/**
 * Releases escrowed funds to the recipient.
 *
 * Maps to the contract's `release_escrow(escrow_id, caller)` call; the contract
 * enforces that `caller` is permitted to release.
 *
 * @param client - Configured {@link TrustFlowClient}
 * @param params - Release parameters: `escrowId` and `caller`
 * @returns The transaction hash returned by `invokeContract`
 * @throws {TrustFlowError} `VALIDATION_ERROR` if `escrowId` or `caller` is invalid, or
 * `UNAUTHORIZED` if `caller` is missing
 */
export async function releaseEscrow(
  client: TrustFlowClient,
  params: ReleaseEscrowParams,
): Promise<string> {
  if (!params.escrowId) {
    throw TrustFlowError.validation('escrowId', 'Required');
  }
  if (!params.caller) {
    throw TrustFlowError.unauthorized('release');
  }
  const args = buildReleaseArgs(params.escrowId, params.caller);
  const res = await invokeContract(client, 'release_escrow', args, params.caller);

  if (!res.success) {
    throw TrustFlowError.wrap(new Error(res.error || 'Escrow release failed'), res.code);
  }

  logger.info('Escrow released', {
    escrowId: params.escrowId,
    caller: params.caller,
    txHash: res.txHash,
  });

  return res.txHash ?? `tx_release_${params.escrowId}_${Date.now()}`;
}

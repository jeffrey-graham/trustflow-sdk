import { Address, nativeToScVal } from '@stellar/stellar-sdk';
import type { CreateEscrowParams } from '../types';
import type { VotePayload } from '../types/juror';
import { assertStellarAddress, isValidAddress, isValidEscrowId } from '../utils/validation';
import { TrustFlowError } from '../errors';

function assertEscrowId(escrowId: string): void {
  if (!isValidEscrowId(escrowId)) {
    throw TrustFlowError.validation('escrowId', `not a usable escrow id: "${escrowId}"`);
  }
}

export function buildCreateEscrowArgs(params: CreateEscrowParams): unknown[] {
  // Reject a malformed address here (#111) so callers get a
  // TrustFlowError.validation(...) instead of whatever `new Address()` throws.
  assertStellarAddress(params.sender, 'sender');
  assertStellarAddress(params.recipient, 'recipient');
  const args: unknown[] = [
    new Address(params.sender).toScVal(),
    new Address(params.recipient).toScVal(),
    nativeToScVal(params.amountStroops, { type: 'i128' }),
    nativeToScVal(params.durationBlocks ?? 0, { type: 'u32' }),
  ];

  if (params.milestones && params.milestones.length > 0) {
    const encodedMilestones = params.milestones.map((m) => {
      const entry: Record<string, unknown> = {};
      if (m.amount !== undefined) {
        entry.amount = nativeToScVal(m.amount, { type: 'i128' });
      }
      const dl = m.deadline ?? m.expiration;
      if (dl !== undefined) {
        const sec = typeof dl === 'number' ? dl : Math.floor(new Date(dl).getTime() / 1000);
        entry.deadline = nativeToScVal(sec, { type: 'u64' });
      }
      if (m.description !== undefined) {
        entry.description = nativeToScVal(m.description, { type: 'string' });
      }
      return nativeToScVal(entry);
    });
    args.push(nativeToScVal(encodedMilestones));
  }

  return args;
}

/**
 * Encodes cancellation arguments for an escrow.
 *
 * Encodes `escrowId` as a string and unreleased milestone indices as a Soroban
 * `Vec<u32>` ScVal matching the contract's expected cancellation signature.
 *
 * @param escrowId - Unique identifier of the escrow to cancel
 * @param unreleasedMilestoneIndices - Array of unreleased milestone indices (default empty)
 * @returns Array of encoded ScVal contract call arguments
 */
export function buildCancelArgs(
  escrowId: string,
  unreleasedMilestoneIndices: number[] = [],
): unknown[] {
  assertEscrowId(escrowId);
  const elements = unreleasedMilestoneIndices.map((idx) => {
    if (!Number.isInteger(idx) || idx < 0) {
      throw TrustFlowError.validation('milestoneIndex', 'Must be a non-negative integer');
    }
    return nativeToScVal(idx, { type: 'u32' });
  });
  return [nativeToScVal(escrowId, { type: 'string' }), nativeToScVal(elements)];
}

export function buildReleaseArgs(escrowId: string, caller: string): unknown[] {
  assertEscrowId(escrowId);
  assertStellarAddress(caller, 'caller');
  return [nativeToScVal(escrowId, { type: 'string' }), new Address(caller).toScVal()];
}

/**
 * Encodes a beneficiary's withdrawal of already-cleared escrow funds.
 *
 * Distinct from `buildReleaseArgs`: release is the depositor/authoriser moving
 * funds to the beneficiary, while claim is the beneficiary pulling funds the
 * contract has already cleared for withdrawal.
 */
export function buildClaimArgs(escrowId: string, claimant: string): unknown[] {
  assertEscrowId(escrowId);
  assertStellarAddress(claimant, 'claimant');
  return [nativeToScVal(escrowId, { type: 'string' }), new Address(claimant).toScVal()];
}

/**
 * Encodes a funding call that transfers an asset (e.g. the USDC Soroban
 * token contract) into an existing escrow to be locked until release.
 *
 * Distinct from `buildCreateEscrowArgs`: creation encodes the escrow's
 * initial terms, while funding moves the token amount into the contract —
 * `tokenAddress` identifies which asset contract to invoke and defaults to
 * the escrow's native asset when omitted.
 */
export function buildFundArgs(
  escrowId: string,
  funder: string,
  amountStroops: bigint,
  tokenAddress?: string,
): unknown[] {
  assertEscrowId(escrowId);
  assertStellarAddress(funder, 'funder');
  if (tokenAddress !== undefined && !isValidAddress(tokenAddress)) {
    throw TrustFlowError.validation(
      'tokenAddress',
      `Invalid Stellar address for "tokenAddress": ${tokenAddress}`,
    );
  }
  const args: unknown[] = [
    nativeToScVal(escrowId, { type: 'string' }),
    new Address(funder).toScVal(),
    nativeToScVal(amountStroops, { type: 'i128' }),
  ];
  if (tokenAddress) {
    args.push(new Address(tokenAddress).toScVal());
  }
  return args;
}

export function buildDisputeArgs(
  escrowId: string,
  caller: string,
  maybeReason?: string,
): unknown[] {
  assertEscrowId(escrowId);
  assertStellarAddress(caller, 'caller');
  const args: unknown[] = [
    nativeToScVal(escrowId, { type: 'string' }),
    new Address(caller).toScVal(),
  ];
  if (maybeReason !== undefined) {
    args.push(nativeToScVal(maybeReason, { type: 'string' }));
  }
  return args;
}

/**
 * Encodes a juror's vote into contract call arguments.
 *
 * Plaintext votes encode `choice` as a symbol so it's readable directly from
 * the ledger; encrypted votes encode `ciphertext` as opaque bytes instead —
 * the contract stores it as-is until the dispute's reveal phase.
 */
export function buildVoteArgs(
  disputeId: string,
  jurorAddress: string,
  vote: VotePayload,
): unknown[] {
  const voteScVal = vote.encrypted
    ? nativeToScVal(Buffer.from(vote.ciphertext, 'base64'), { type: 'bytes' })
    : nativeToScVal(vote.choice, { type: 'symbol' });

  return [
    nativeToScVal(disputeId, { type: 'string' }),
    new Address(jurorAddress).toScVal(),
    nativeToScVal(vote.encrypted, { type: 'bool' }),
    voteScVal,
  ];
}

/**
 * Encodes a juror's vote reveal into contract call arguments.
 *
 * Encodes `disputeId` as a string, `jurorAddress` as an Address,
 * `voteForDepositor` as a boolean (true for depositor, false for beneficiary),
 * and `salt` as 32-byte ScVal bytes matching the contract's expected reveal signature.
 *
 * Note: commit-reveal voting does not support 'abstain'. Callers needing 'abstain'
 * must cast a plaintext vote instead.
 *
 * @param disputeId - Unique identifier of the dispute
 * @param jurorAddress - Stellar address of the revealing juror
 * @param voteForDepositor - Boolean vote choice: true for depositor (1), false for beneficiary (0)
 * @param salt - 32-byte secret salt used during commitment creation (Uint8Array or hex string)
 * @returns Array of encoded ScVal contract call arguments
 */
export function buildRevealArgs(
  disputeId: string,
  jurorAddress: string,
  voteForDepositor: boolean,
  salt: Uint8Array | string,
): unknown[] {
  assertEscrowId(disputeId);
  assertStellarAddress(jurorAddress, 'jurorAddress');

  if ((voteForDepositor as unknown) === 'abstain') {
    throw new TrustFlowError(
      "Commit-reveal voting does not support 'abstain'. Callers needing 'abstain' must cast a plaintext vote instead.",
      'VALIDATION_ERROR',
    );
  }

  if (typeof voteForDepositor !== 'boolean') {
    throw new TrustFlowError('voteForDepositor must be a boolean', 'VALIDATION_ERROR');
  }

  let saltBytes: Buffer;
  if (typeof salt === 'string') {
    if (salt.length !== 64 || !/^[0-9a-fA-F]+$/.test(salt)) {
      throw new TrustFlowError(
        'Salt hex string must be exactly 64 characters (32 bytes)',
        'VALIDATION_ERROR',
      );
    }
    saltBytes = Buffer.from(salt, 'hex');
  } else if (salt instanceof Uint8Array) {
    if (salt.length !== 32) {
      throw new TrustFlowError('Salt must be exactly 32 bytes', 'VALIDATION_ERROR');
    }
    saltBytes = Buffer.from(salt);
  } else {
    throw new TrustFlowError(
      'Salt must be a 32-byte Uint8Array or 64-character hex string',
      'VALIDATION_ERROR',
    );
  }

  return [
    nativeToScVal(disputeId, { type: 'string' }),
    new Address(jurorAddress).toScVal(),
    nativeToScVal(voteForDepositor, { type: 'bool' }),
    nativeToScVal(saltBytes, { type: 'bytes' }),
  ];
}

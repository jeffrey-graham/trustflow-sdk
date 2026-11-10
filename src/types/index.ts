export * from '../types';
export * from './contract';
export * from './events';
export * from './juror';
export * from './multisig';
export * from './profile';

export type StellarAddress = string;
export type EscrowId = string;
export type TxHash = string;

/** Representation of a single milestone in an escrow. */
export interface EscrowMilestone {
  amount: bigint;
  description?: string;
  deadline?: Date | number | string;
}

/** Parameters for configuring an escrow. */
export interface EscrowParams {
  /** Depositor Stellar account address. */
  depositor: StellarAddress;
  /** Beneficiary Stellar account address. */
  beneficiary: StellarAddress;
  /** Amount in human-readable XLM decimal string. */
  amountXLM: string;
  /** Optional custom Soroban token contract address. */
  tokenAddress?: StellarAddress;
  /** Optional expiration duration in blocks. */
  deadlineBlocks?: number;
  /** Optional designated arbitrator Stellar account address. */
  arbitrator?: StellarAddress;
  /** Optional list of milestones for multi-milestone escrow. */
  milestones?: EscrowMilestone[];
}

/** State of an escrow. */
export interface EscrowState {
  id: EscrowId;
  params: EscrowParams;
  status: 'pending' | 'active' | 'released' | 'disputed' | 'cancelled';
  contractEscrowId?: number;
  txHash?: TxHash;
  createdAt: number;
}

/** Parameters for raising an escrow dispute. */
export interface DisputeParams {
  escrowId: EscrowId;
  reason: string;
  evidence?: string;
}

/**
 * Representation of an escrow dispute returned by the TrustFlow backend (Issue #471).
 */
export interface Dispute {
  id: string;
  escrowId?: EscrowId;
  reason?: string;
  status: 'open' | 'resolving' | 'resolved' | 'cancelled' | string;
  evidence?: string;
  createdAt?: number | string;
  resolvedAt?: number | string;
  jurorCount?: number;
}

/** Standard result envelope for SDK operations. */
export type SDKResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; aborted?: boolean };

/**
 * Parameters for paginated gig listing (#24, #211, #235).
 * Supports status, parties, date ranges, tokens, amount bounds, and sorting.
 */
export interface GetGigsParams {
  /** Opaque cursor returned by a previous `getGigs` call to fetch the next page. */
  cursor?: string;
  /** Maximum records to return per page. Capped at 100 by the backend. Defaults to 20. */
  limit?: number;
  /** Filter by escrow status (case-insensitive string or EscrowState status). */
  status?: EscrowState['status'] | string;
  /** Filter by depositor Stellar address. */
  depositor?: StellarAddress;
  /** Filter by beneficiary Stellar address. */
  beneficiary?: StellarAddress;
  /** Filter for gigs created at or after this date/timestamp. */
  createdAfter?: string | number | Date;
  /** Filter for gigs created at or before this date/timestamp. */
  createdBefore?: string | number | Date;
  /** Filter by custom token address. */
  tokenAddress?: string;
  /** Filter by minimum amount. */
  minAmount?: bigint | number | string;
  /** Filter by maximum amount. */
  maxAmount?: bigint | number | string;
  /** Field to sort results by. */
  sortBy?: 'created_at' | 'amount' | 'deadline' | 'status';
  /** Sort direction: "asc" or "desc". */
  sortOrder?: 'asc' | 'desc';
}

/**
 * A single page of gigs returned by `getGigs`.
 */
export interface GigsPage {
  /** Gig records for this page. */
  data: EscrowState[];
  /**
   * Cursor to pass as `cursor` on the next `getGigs` call.
   * `null` when this is the last page.
   */
  nextCursor: string | null;
  /** Whether another page exists after this one. */
  hasMore: boolean;
}

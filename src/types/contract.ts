import type { HttpInterceptors } from '../utils/interceptors';
import type { StellarNetwork } from '../stellar/network';
import type { TrustFlowErrorCode } from '../errors';

export interface ContractConfig {
  contractId: string;
  network: StellarNetwork;
  rpcUrl: string;
  networkPassphrase: string;
  apiBaseUrl?: string;
  apiKey?: string;
  /**
   * Client-wide per-request timeout in milliseconds for backend API calls,
   * used when a client's own options do not set one. Defaults to 10s.
   */
  timeoutMs?: number;
  /** Request/response interceptor hooks applied to backend API calls. */
  interceptors?: HttpInterceptors;
}

export interface InvokeContractParams {
  method: string;
  args: unknown[];
  source: string;
  fee?: number;
}

export interface ContractCallResult {
  success: boolean;
  returnValue?: unknown;
  /** Raw Soroban `ScVal` return value when available from simulation. */
  rawReturnValue?: unknown;
  txHash?: string;
  errorCode?: number;
  gasUsed?: number;
  /** Error message when `success` is false, describing why the call failed. */
  error?: string;
  /**
   * The SDK error code (e.g. `TIMEOUT`, `ACCOUNT_NOT_FOUND`) when `success` is
   * false because a `TrustFlowError` was thrown. Branch on this rather than
   * parsing `error`. Distinct from the numeric contract-level `errorCode`.
   */
  code?: TrustFlowErrorCode;
}

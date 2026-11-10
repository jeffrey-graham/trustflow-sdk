import type { TrustFlowClient } from '../client';
import type { ContractConfig } from '../types/contract';
import type { DisputeEscrowParams } from '../types';
import { Dispute, DisputeParams, SDKResult } from '../types/index';
import { TrustFlowError } from '../errors';
import { buildDisputeArgs } from '../contract/build';
import { invokeContract } from '../contract/invoke';
import { createApiHttpClient, toApiErrorMessage } from '../utils/http';
import type { ApiRetryConfig } from '../utils/http';
import type { HttpInterceptors } from '../utils/interceptors';
import { logger } from '../utils/logger';
import { isValidEscrowId } from '../utils/validation';

/**
 * Raises a dispute directly against the TrustFlow contract.
 *
 * Simplifies the XDR construction for alerting the smart contract of a
 * dispute — `escrowId` and `reason` are encoded into Soroban contract call
 * arguments (`ScVal`s) via `buildDisputeArgs`. Distinct from
 * `DisputeClient.raiseDispute`, which records the dispute with the backend
 * API rather than the on-chain contract.
 *
 * @param _client - Configured {@link TrustFlowClient}, reserved for the
 * contract call once a live signer is wired in
 * @param params - Dispute parameters: `escrowId`, `caller` and `reason`
 * @returns A dispute transaction identifier. This is currently a locally
 * generated placeholder, not an on-chain hash, until the encoded arguments are
 * passed to the shared tx-pipeline.
 * @throws {TrustFlowError} `VALIDATION_ERROR` if `escrowId` or `reason` is
 * missing or blank, or `UNAUTHORIZED` if `caller` is missing
 *
 * @example
 * ```typescript
 * const txId = await disputeEscrow(client, {
 *   escrowId: escrow.id,
 *   caller: recipientAddress,
 *   reason: 'Deliverable not received',
 * });
 * ```
 */
export async function disputeEscrow(
  client: TrustFlowClient,
  params: DisputeEscrowParams,
): Promise<string> {
  if (!params.escrowId) {
    throw TrustFlowError.validation('escrowId', 'Required');
  }
  if (!params.caller) {
    throw TrustFlowError.unauthorized('dispute');
  }
  if (!params.reason || !params.reason.trim()) {
    throw TrustFlowError.validation('reason', 'Required');
  }
  const args = buildDisputeArgs(params.escrowId, params.caller, params.reason);
  const res = await invokeContract(client, 'dispute_escrow', args, params.caller);

  if (!res.success) {
    throw TrustFlowError.wrap(new Error(res.error || 'Escrow dispute failed'), res.code);
  }

  logger.info('Escrow disputed', {
    escrowId: params.escrowId,
    caller: params.caller,
    txHash: res.txHash,
  });

  return res.txHash ?? `tx_dispute_${params.escrowId}_${Date.now()}`;
}

/** Constructor options for {@link DisputeClient}. */
export interface DisputeClientOptions {
  /** Per-request timeout (ms) applied to backend dispute calls. Falls back to `config.timeoutMs`. */
  timeoutMs?: number;
  /**
   * Retry budget for backend calls. Defaults to 3 retries with a 250ms base
   * delay and a 2s cap.
   *
   * Only transient failures are retried. `raiseDispute` is a `POST`, so it is
   * **not** retried on `5xx` or a transport error by default — the backend may
   * have created the dispute before the response was lost. `getDispute` is a
   * `GET` and is retried.
   */
  retry?: ApiRetryConfig;
  /** Request/response interceptor hooks. Defaults to `config.interceptors`. */
  interceptors?: HttpInterceptors;
}

/**
 * Client for recording and reading disputes through the TrustFlow backend API.
 *
 * Distinct from {@link disputeEscrow}, which targets the on-chain contract.
 * Every method resolves to an {@link SDKResult} rather than throwing, so
 * backend failures are handled as values.
 *
 * @example
 * ```typescript
 * const disputes = new DisputeClient({
 *   apiBaseUrl: 'https://api.trustflow.xyz',
 *   apiKey: process.env.API_KEY!,
 * });
 * const created = await disputes.raiseDispute({ escrowId, reason: 'Late delivery' });
 * if (created.ok) console.log(created.data.disputeId);
 * ```
 */
export class DisputeClient {
  private readonly http;
  private readonly apiUrl: string;
  private readonly token: string;

  constructor(config: ContractConfig, options?: DisputeClientOptions);
  /** @deprecated Pass a ContractConfig object instead. */
  constructor(apiUrl: string, token: string, options?: DisputeClientOptions);
  constructor(
    configOrUrl: ContractConfig | string,
    tokenOrOptions: string | DisputeClientOptions = {},
    legacyOptions: DisputeClientOptions = {},
  ) {
    const config = typeof configOrUrl === 'string' ? undefined : configOrUrl;
    this.apiUrl = config ? (config.apiBaseUrl ?? '') : String(configOrUrl);
    this.token = config
      ? (config.apiKey ?? '')
      : typeof tokenOrOptions === 'string'
        ? tokenOrOptions
        : '';
    const options = typeof tokenOrOptions === 'string' ? legacyOptions : tokenOrOptions;

    if (!this.apiUrl) {
      throw new Error('apiBaseUrl is required for DisputeClient');
    }
    if (!this.token) {
      throw new Error('apiKey is required for DisputeClient');
    }

    this.http = createApiHttpClient({
      baseURL: this.apiUrl,
      timeoutMs: options?.timeoutMs ?? config?.timeoutMs,
      retry: options.retry,
      interceptors: options?.interceptors ?? config?.interceptors,
      additionalHeaders: {
        Authorization: `Bearer ${this.token}`,
      },
    });
  }

  /**
   * Creates a dispute via the backend API.
   *
   * **Retry behaviour:** a `POST`, so a `429`/`5xx` or transport error is
   * surfaced immediately rather than replayed — a retried create could file the
   * dispute twice. Set `{ trustflowRetry: true }` on the underlying call (or use
   * an idempotency-key-based endpoint) when replaying is safe.
   *
   * @param params - Dispute payload sent to `POST /disputes`
   * @returns An {@link SDKResult} carrying the new `disputeId`, or `ok: false`
   *   with an error message. Does not throw on backend failure.
   *
   * @example
   * ```typescript
   * const result = await disputes.raiseDispute({ escrowId, reason: 'No delivery' });
   * if (!result.ok) console.error(result.error);
   * ```
   */
  async raiseDispute(params: DisputeParams): Promise<SDKResult<{ disputeId: string }>> {
    if (!params || !isValidEscrowId(params.escrowId)) {
      return { ok: false, error: 'escrowId is required' };
    }
    if (typeof params.reason !== 'string' || params.reason.trim().length < 10) {
      return { ok: false, error: 'Dispute reason must be at least 10 characters' };
    }
    try {
      const response = await this.http.post<{ id: string }>('/disputes', params);
      const data = response.data;
      return { ok: true, data: { disputeId: data.id } };
    } catch (e) {
      logger.error('Failed to raise dispute', e);
      return { ok: false, error: toApiErrorMessage(e) };
    }
  }

  /**
   * Retrieves dispute details from the backend API.
   *
   * **Retry behaviour:** a `GET`, so it is idempotent — `429`, `5xx` and
   * transport errors are retried with capped, jittered backoff, honouring a
   * `Retry-After` header when the backend sends one. `4xx` fails immediately.
   *
   * @param escrowId - Escrow whose dispute should be fetched
   * @returns An {@link SDKResult} carrying the dispute record, or `ok: false`
   *   with an error message. Does not throw on backend failure.
   *
   * @example
   * ```typescript
   * const result = await disputes.getDispute(escrowId);
   * if (result.ok) console.log(result.data);
   * ```
   */
  async getDispute(escrowId: string): Promise<SDKResult<Dispute>> {
    if (!isValidEscrowId(escrowId)) {
      return { ok: false, error: 'escrowId is required' };
    }
    try {
      const response = await this.http.get<Dispute>(`/disputes/${encodeURIComponent(escrowId)}`);
      return { ok: true, data: response.data };
    } catch (e) {
      logger.error(`Failed to get dispute for escrow ${escrowId}`, e);
      return { ok: false, error: toApiErrorMessage(e) };
    }
  }
}

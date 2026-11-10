import { rpc, Contract, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../client';
import type { ContractCallResult } from '../types/contract';
import { TrustFlowError } from '../errors';
import type { AccountOptions } from '../accounts/types';
import { withTransientRetry } from '../utils/node-retry';
import { padResourceFee } from '../utils/resource-fee';
import { describeError, logger } from '../utils/logger';
import type { ReadContractStateOptions } from './read';
import { simulateTransaction } from './simulation';

export type SignAndSubmitFn = (xdr: string) => Promise<string>;

/** Per-call account and retry overrides for {@link invokeContract}. */
export interface InvokeContractOptions extends AccountOptions {
  /**
   * Overrides the client's retry budget for this call — `attempts` counts the
   * total tries (so `attempts: 1` disables retries), and `maxDelayMs` caps each
   * delay. See {@link import('../utils/retry').cappedExponentialBackoff}.
   */
  retry?: ReadContractStateOptions['retry'];
  /**
   * Per-attempt timeout in milliseconds for the `getAccount` and
   * `simulateTransaction` calls, overriding the client-wide
   * {@link ClientConfig.timeoutMs}.
   */
  timeoutMs?: number;
  /**
   * Safety multiplier applied to the simulated `minResourceFee` before the
   * transaction is assembled for signing, so a ledger-state change between
   * simulation and submission does not fail with "insufficient resource fee"
   * (#438). Defaults to `1.1`, matching `TransactionPipeline.prepare()`. Only
   * affects the `signAndSubmit` path.
   */
  resourceFeeMultiplier?: number;
}

/**
 * Assembles, simulates and optionally signs+submits a contract call.
 *
 * ### Retry behaviour
 *
 * `getAccount` and `simulateTransaction` are both retried on transient
 * failures only (connection reset, timeout, `429`, `5xx`), with capped,
 * jittered backoff. A simulation *error* response is the node's verdict and is
 * never retried — the same envelope would fail identically. A thrown
 * `getAccount` failure for a genuinely missing account is likewise retried once
 * by the classifier's default (an unrecognised error from a transport is
 * treated as a transport failure), then reported as
 * `{ success: false, error }`, matching this function's existing contract of
 * never throwing.
 *
 * Each RPC attempt is bounded by `options.timeoutMs`, falling back to the
 * client-wide {@link ClientConfig.timeoutMs}.
 *
 * ### Error reporting
 *
 * When the simulation fails or an exception is caught, the result includes the
 * RPC's error message in the `error` field so callers can diagnose the failure
 * without parsing logs. A thrown {@link TrustFlowError} (for example `TIMEOUT`
 * or an unregistered `options.account`, `ACCOUNT_NOT_FOUND`) also sets `code`,
 * so callers can branch on the typed code rather than the message.
 *
 * @param client - Configured client, for the contract ID, network and retry budget
 * @param method - Contract method name
 * @param args - Positional arguments, already encoded to `ScVal`s
 * @param caller - `G...` address whose sequence number and sequence-locked
 *   footprint back the transaction
 * @param signAndSubmit - Optional callback to sign and broadcast the envelope
 * @param options - Per-call account, retry and timeout overrides
 * @returns The call outcome; never throws for expected failure modes
 */
export async function invokeContract(
  client: TrustFlowClient,
  method: string,
  args: unknown[],
  caller: string,
  signAndSubmit?: SignAndSubmitFn,
  options: InvokeContractOptions = {},
): Promise<ContractCallResult> {
  const server = client.getSorobanServer();
  const contract = new Contract(client.contractId);

  logger.debug('Invoking contract method', {
    method,
    caller,
    contractId: client.contractId,
    argsCount: args.length,
  });

  try {
    client.resolveAccount(options.account);
    const account = await withTransientRetry(
      () => server.getAccount(caller),
      { ...options.retry, timeoutMs: options.timeoutMs ?? client.timeoutMs },
      client.retryConfig,
      'rpc.getAccount',
    );
    const operation = contract.call(method, ...(args as any[]));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulation = await simulateTransaction(
      server,
      tx,
      { ...options.retry, timeoutMs: options.timeoutMs ?? client.timeoutMs },
      client.retryConfig,
    );

    if (!simulation.success) {
      logger.warn('Contract simulation failed', { method, error: simulation.error });
      return {
        success: false,
        error: simulation.error,
      };
    }

    logger.debug('Contract simulation successful', { method, gasUsed: simulation.cost });

    if (!signAndSubmit) {
      const gasUsed = Number(simulation.cost?.cpuInsns || simulation.minResourceFee || 0);
      return {
        success: true,
        returnValue: simulation.returnValue,
        rawReturnValue: simulation.rawReturnValue,
        gasUsed,
      };
    }

    const paddedFee = padResourceFee(simulation.minResourceFee, options.resourceFeeMultiplier);
    // Same ordering as TransactionPipeline.prepare(): the padded fee must land
    // in the Soroban data itself, not only in the `minResourceFee` argument.
    simulation.transactionData?.setResourceFee(paddedFee);
    // Assemble from the full parsed response so the simulated authorization
    // entries (`result.auth`) are carried into the built operation (#433).
    const prepared = rpc
      .assembleTransaction(tx, {
        ...simulation.response,
        minResourceFee: paddedFee,
      } as rpc.Api.SimulateTransactionSuccessResponse)
      .build();
    const xdr = prepared.toXDR();
    logger.debug('Signing and submitting transaction', { method, xdrLength: xdr.length });
    const txHash = await signAndSubmit(xdr);

    logger.info('Contract call submitted', { method, txHash });
    const gasUsed = Number(simulation.cost?.cpuInsns || simulation.minResourceFee || 0);
    return {
      success: true,
      txHash,
      returnValue: simulation.returnValue,
      rawReturnValue: simulation.rawReturnValue,
      gasUsed,
    };
  } catch (e) {
    logger.error('Contract invocation failed', { method, caller, error: describeError(e) });
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof TrustFlowError ? e.code : undefined;
    return { success: false, error: message, code };
  }
}

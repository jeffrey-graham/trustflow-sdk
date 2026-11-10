import { scValToNative, xdr } from '@stellar/stellar-sdk';
import { createContractBinding, SorobanContractClient } from '../src/contract/bindings';
import * as invokeModule from '../src/contract/invoke';
import * as readModule from '../src/contract/read';
import type { TrustFlowClient } from '../src/client';

function functionEntry(
  name: string,
  inputs: Array<{ name: string; type: xdr.ScSpecTypeDef }>,
  outputs: xdr.ScSpecTypeDef[] = [],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: '',
      name,
      inputs: inputs.map(
        ({ name: inputName, type }) => new xdr.ScSpecFunctionInputV0({ doc: '', name: inputName, type }),
      ),
      outputs,
    }),
  );
}

function unionEntry(
  name: string,
  cases: Array<{ name: string; types?: xdr.ScSpecTypeDef[] }>,
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtUnionV0(
    new xdr.ScSpecUdtUnionV0({
      doc: '',
      lib: '',
      name,
      cases: cases.map((item) =>
        item.types
          ? xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseTupleV0(
              new xdr.ScSpecUdtUnionCaseTupleV0({ doc: '', name: item.name, type: item.types }),
            )
          : xdr.ScSpecUdtUnionCaseV0.scSpecUdtUnionCaseVoidV0(
              new xdr.ScSpecUdtUnionCaseVoidV0({ doc: '', name: item.name }),
            ),
      ),
    }),
  );
}

function structEntry(
  name: string,
  fields: Array<{ name: string; type: xdr.ScSpecTypeDef }>,
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtStructV0(
    new xdr.ScSpecUdtStructV0({
      doc: '',
      lib: '',
      name,
      fields: fields.map(
        ({ name: fieldName, type }) => new xdr.ScSpecUdtStructFieldV0({ doc: '', name: fieldName, type }),
      ),
    }),
  );
}

function udtType(name: string): xdr.ScSpecTypeDef {
  return xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
}

describe('SorobanContractClient invoke() and read() spec decoding (#579)', () => {
  const mockClient = {
    contractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    getNetworkPassphrase: () => 'Test SDF Network ; September 2015',
  } as unknown as TrustFlowClient;

  const caller = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

  const paymentUnion = unionEntry('PaymentOutcome', [
    { name: 'None' },
    { name: 'Released', types: [xdr.ScSpecTypeDef.scSpecTypeU64()] },
  ]);

  const escrowStruct = structEntry('EscrowSummary', [
    { name: 'id', type: xdr.ScSpecTypeDef.scSpecTypeString() },
    { name: 'amount', type: xdr.ScSpecTypeDef.scSpecTypeU64() },
  ]);

  const specEntries = [
    paymentUnion,
    escrowStruct,
    functionEntry(
      'get_balance',
      [{ name: 'account', type: xdr.ScSpecTypeDef.scSpecTypeAddress() }],
      [xdr.ScSpecTypeDef.scSpecTypeU32()],
    ),
    functionEntry(
      'release_escrow',
      [{ name: 'escrow_id', type: xdr.ScSpecTypeDef.scSpecTypeString() }],
      [udtType('PaymentOutcome')],
    ),
    functionEntry(
      'get_summary',
      [{ name: 'escrow_id', type: xdr.ScSpecTypeDef.scSpecTypeString() }],
      [udtType('EscrowSummary')],
    ),
  ];

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('invoke() decodes non-void primitive and union return values without throwing (#579)', async () => {
    const binding = createContractBinding(mockClient, specEntries);

    const invokeSpy = jest.spyOn(invokeModule, 'invokeContract').mockResolvedValueOnce({
      success: true,
      // Generic scValToNative output as returned by simulateTransaction / invokeContract
      returnValue: 42,
      gasUsed: 100,
    });

    const balanceRes = await binding.invoke('get_balance', { account: caller }, caller);
    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(balanceRes.success).toBe(true);
    expect(balanceRes.result).toBe(42);

    // Union output where scValToNative produces ['Released', 500n]
    const rawUnionScVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('Released'),
      xdr.ScVal.scvU64(xdr.Uint64.fromString('500')),
    ]);
    invokeSpy.mockResolvedValueOnce({
      success: true,
      returnValue: scValToNative(rawUnionScVal),
      gasUsed: 200,
    });

    const releaseRes = await binding.methods.release_escrow({ escrow_id: 'esc-1' }, caller);
    expect(releaseRes).toMatchObject({
      success: true,
      result: { tag: 'Released', values: [500n] },
    });
  });

  it('read() exercises spec-based decoding for union and struct outputs (#579)', async () => {
    const binding = new SorobanContractClient(mockClient, specEntries);

    const rawUnionScVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('Released'),
      xdr.ScVal.scvU64(xdr.Uint64.fromString('1250')),
    ]);
    // readContractState returns scValToNative(retval), which for a Soroban union is ['Released', 1250n]
    const readSpy = jest
      .spyOn(readModule, 'readContractState')
      .mockResolvedValueOnce(scValToNative(rawUnionScVal));

    const decodedUnion = await binding.read('release_escrow', { escrow_id: 'esc-1' });
    expect(readSpy).toHaveBeenCalledTimes(1);
    expect(decodedUnion).toEqual({ tag: 'Released', values: [1250n] });

    readSpy.mockResolvedValueOnce({ id: 'esc-99', amount: 900n });
    const summary = await binding.read('get_summary', { escrow_id: 'esc-99' });
    expect(summary).toEqual({ id: 'esc-99', amount: 900n });
  });
});

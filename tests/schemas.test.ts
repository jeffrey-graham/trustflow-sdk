import {
  StellarAddressSchema,
  ContractIdSchema,
  StroopsSchema,
  NetworkSchema,
  CreateEscrowSchema,
  ReleaseEscrowSchema,
  DisputeEscrowSchema,
  ClientConfigSchema,
} from '../src';

const ADDR_A = 'G' + 'A'.repeat(55);
const ADDR_B = 'G' + 'B'.repeat(55);
const CONTRACT_ID = 'C' + 'A'.repeat(55);

describe('exported Zod schemas', () => {
  it('are reachable from the package root (not just src/schemas)', () => {
    expect(StellarAddressSchema).toBeDefined();
    expect(CreateEscrowSchema).toBeDefined();
  });

  describe('StellarAddressSchema', () => {
    it('accepts a well-formed address', () => {
      expect(StellarAddressSchema.safeParse(ADDR_A).success).toBe(true);
    });

    it.each(['not-an-address', 'A' + 'A'.repeat(55), 'G' + 'A'.repeat(54)])(
      'rejects %s',
      (value) => {
        expect(StellarAddressSchema.safeParse(value).success).toBe(false);
      },
    );
  });

  describe('ContractIdSchema', () => {
    it('accepts a well-formed contract id', () => {
      expect(ContractIdSchema.safeParse(CONTRACT_ID).success).toBe(true);
    });

    it('rejects an address prefixed with G instead of C', () => {
      expect(ContractIdSchema.safeParse(ADDR_A).success).toBe(false);
    });
  });

  describe('StroopsSchema', () => {
    it('accepts a positive bigint', () => {
      expect(StroopsSchema.safeParse(1_000_000n).success).toBe(true);
    });

    it('rejects zero, negative, and non-bigint values', () => {
      expect(StroopsSchema.safeParse(0n).success).toBe(false);
      expect(StroopsSchema.safeParse(-1n).success).toBe(false);
      expect(StroopsSchema.safeParse(1000).success).toBe(false);
    });
  });

  describe('NetworkSchema', () => {
    it.each(['MAINNET', 'TESTNET', 'FUTURENET', 'LOCALNET'])('accepts %s', (network) => {
      expect(NetworkSchema.safeParse(network).success).toBe(true);
    });

    it('rejects an unsupported network', () => {
      expect(NetworkSchema.safeParse('DEVNET').success).toBe(false);
      expect(NetworkSchema.safeParse('UNKNOWN_NET').success).toBe(false);
    });
  });

  describe('CreateEscrowSchema', () => {
    it('parses valid input and defaults network to TESTNET', () => {
      const result = CreateEscrowSchema.parse({
        sender: ADDR_A,
        recipient: ADDR_B,
        amount: 1_000_000n,
      });
      expect(result.network).toBe('TESTNET');
    });

    it('rejects a memo longer than 28 characters', () => {
      const result = CreateEscrowSchema.safeParse({
        sender: ADDR_A,
        recipient: ADDR_B,
        amount: 1_000_000n,
        memo: 'x'.repeat(29),
      });
      expect(result.success).toBe(false);
    });

    it('rejects an invalid sender address', () => {
      const result = CreateEscrowSchema.safeParse({
        sender: 'not-an-address',
        recipient: ADDR_B,
        amount: 1_000_000n,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ReleaseEscrowSchema', () => {
    it('parses valid input', () => {
      const result = ReleaseEscrowSchema.safeParse({ escrowId: 'escrow-1', recipient: ADDR_A });
      expect(result.success).toBe(true);
    });

    it('rejects an empty escrowId', () => {
      const result = ReleaseEscrowSchema.safeParse({ escrowId: '', recipient: ADDR_A });
      expect(result.success).toBe(false);
    });
  });

  describe('DisputeEscrowSchema', () => {
    it('rejects a reason shorter than 10 characters', () => {
      const result = DisputeEscrowSchema.safeParse({ escrowId: 'escrow-1', reason: 'too short' });
      expect(result.success).toBe(false);
    });

    it('accepts a valid reason and optional evidence URL', () => {
      const result = DisputeEscrowSchema.safeParse({
        escrowId: 'escrow-1',
        reason: 'work was never delivered',
        evidence: 'https://example.com/proof.png',
      });
      expect(result.success).toBe(true);
    });

    it('rejects a malformed evidence URL', () => {
      const result = DisputeEscrowSchema.safeParse({
        escrowId: 'escrow-1',
        reason: 'work was never delivered',
        evidence: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ClientConfigSchema', () => {
    it('parses valid config and defaults network to TESTNET', () => {
      const result = ClientConfigSchema.parse({ contractId: CONTRACT_ID });
      expect(result.network).toBe('TESTNET');
    });

    it('rejects an invalid rpcUrl', () => {
      const result = ClientConfigSchema.safeParse({ contractId: CONTRACT_ID, rpcUrl: 'nope' });
      expect(result.success).toBe(false);
    });

    it('rejects a missing contractId', () => {
      const result = ClientConfigSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('keeps timeoutMs, retry, accounts and rpcFailover instead of stripping them (#437)', () => {
      const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const result = ClientConfigSchema.safeParse({
        contractId: CONTRACT_ID,
        timeoutMs: 5000,
        retry: { retries: 2, jitter: false },
        accounts: [{ address: account, label: 'Alice', roles: ['depositor'] }],
        rpcFailover: { rpcUrls: ['https://rpc.example.com'] },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.timeoutMs).toBe(5000);
      expect(result.data.retry).toEqual({ retries: 2, jitter: false });
      expect(result.data.accounts?.[0]).toMatchObject({ address: account, label: 'Alice' });
      expect(result.data.rpcFailover?.rpcUrls).toEqual(['https://rpc.example.com']);
    });

    it('rejects an invalid account address and a non-positive timeoutMs (#437)', () => {
      expect(
        ClientConfigSchema.safeParse({
          contractId: CONTRACT_ID,
          accounts: [{ address: 'not-a-stellar-address' }],
        }).success,
      ).toBe(false);
      expect(ClientConfigSchema.safeParse({ contractId: CONTRACT_ID, timeoutMs: 0 }).success).toBe(
        false,
      );
    });

    it('keeps and validates rpcHeaders instead of silently dropping them (#602)', () => {
      const parsed = ClientConfigSchema.safeParse({
        contractId: CONTRACT_ID,
        rpcHeaders: { 'x-api-key': 'abc', 'x-trace-id': 'trace-1' },
      });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.rpcHeaders).toEqual({
        'x-api-key': 'abc',
        'x-trace-id': 'trace-1',
      });

      const invalid = ClientConfigSchema.safeParse({
        contractId: CONTRACT_ID,
        rpcHeaders: { 'x-api-key': 123 },
      });
      expect(invalid.success).toBe(false);
    });
  });
});

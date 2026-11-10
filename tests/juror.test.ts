import { Keypair } from '@stellar/stellar-sdk';
import { JurorClient, createVoteCommitment, revealVote } from '../src/juror/client';
import * as invokeModule from '../src/contract/invoke';

import type { ContractConfig } from '../src/types/contract';

const JUROR_ADDRESS = Keypair.random().publicKey();

const CONFIG: ContractConfig = {
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

beforeEach(() => {
  jest.spyOn(invokeModule, 'invokeContract').mockResolvedValue({
    success: true,
    txHash: 'tx_juror_onchain_abc123',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('JurorClient.vote', () => {
  it('accepts a plaintext vote and invokes cast_vote on the contract', async () => {
    const jurors = new JurorClient(CONFIG);
    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      vote: { encrypted: false, choice: 'approve' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.disputeId).toBe('dsp-1');
      expect(result.data.jurorAddress).toBe(JUROR_ADDRESS);
      expect(result.data.encrypted).toBe(false);
      expect(result.data.txHash).toBe('tx_juror_onchain_abc123');
    }
    expect(invokeModule.invokeContract).toHaveBeenCalledWith(
      expect.anything(),
      'cast_vote',
      expect.any(Array),
      JUROR_ADDRESS,
    );
  });

  it('propagates invokeContract failure in vote() as { ok: false }', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValueOnce({
      success: false,
      error: 'Contract rejected vote: not a juror',
    });
    const jurors = new JurorClient(CONFIG);
    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      vote: { encrypted: false, choice: 'approve' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not a juror/);
    }
  });

  it('accepts an encrypted vote with base64 ciphertext', async () => {
    const jurors = new JurorClient(CONFIG);
    const ciphertext = Buffer.from('hidden-choice').toString('base64');
    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      vote: { encrypted: true, ciphertext },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.encrypted).toBe(true);
    }
  });

  it('rejects a missing disputeId', async () => {
    const jurors = new JurorClient(CONFIG);
    const result = await jurors.vote({
      disputeId: '',
      jurorAddress: JUROR_ADDRESS,
      vote: { encrypted: false, choice: 'approve' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*disputeId/i);
    }
  });

  it('rejects an invalid juror address', async () => {
    const jurors = new JurorClient(CONFIG);
    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: 'not-a-stellar-address',
      vote: { encrypted: false, choice: 'approve' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*jurorAddress/i);
    }
  });

  it('rejects an invalid plaintext choice', async () => {
    const jurors = new JurorClient(CONFIG);
    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      // @ts-expect-error deliberately invalid choice for the runtime check
      vote: { encrypted: false, choice: 'maybe' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/vote.choice/);
    }
  });

  it('rejects a non-base64 ciphertext', async () => {
    const jurors = new JurorClient(CONFIG);
    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      vote: { encrypted: true, ciphertext: 'not base64!!' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*vote/i);
    }
  });

  it('rejects an empty ciphertext', async () => {
    const jurors = new JurorClient(CONFIG);
    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      vote: { encrypted: true, ciphertext: '' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*vote/i);
    }
  });
});

describe('commit-reveal voting helpers (Issue #373)', () => {
  it('constructs commitment matching contract sha256(vote_byte ++ 32_byte_salt) layout for true', () => {
    const zeroSalt = new Uint8Array(32);
    const commitment = createVoteCommitment(true, zeroSalt);

    // sha256(0x01 ++ 32 bytes of 0x00)
    expect(commitment.commitmentHex).toBe(
      '1a7dfdeaffeedac489287e85be5e9c049a2ff6470f55cf30260f55395ac1b159',
    );
    expect(commitment.voteForDepositor).toBe(true);
    expect(commitment.salt).toEqual(zeroSalt);
    expect(commitment.commitment.length).toBe(32);
    expect(Buffer.from(commitment.ciphertext, 'base64')).toEqual(
      Buffer.from(commitment.commitment),
    );
  });

  it('constructs commitment matching contract sha256(vote_byte ++ 32_byte_salt) layout for false', () => {
    const zeroSalt = new Uint8Array(32);
    const commitment = createVoteCommitment(false, zeroSalt);

    // Expected sha256(0x00 ++ 32 bytes of 0x00)
    const expectedHash = require('crypto')
      .createHash('sha256')
      .update(Buffer.concat([Buffer.from([0]), Buffer.alloc(32, 0)]))
      .digest('hex');

    expect(commitment.commitmentHex).toBe(expectedHash);
    expect(commitment.voteForDepositor).toBe(false);
  });

  it('automatically generates 32 cryptographically secure random bytes if salt is omitted', () => {
    const commitment1 = createVoteCommitment(true);
    const commitment2 = createVoteCommitment(true);

    expect(commitment1.salt.length).toBe(32);
    expect(commitment2.salt.length).toBe(32);
    // Two random salts must not be identical
    expect(commitment1.saltHex).not.toBe(commitment2.saltHex);
    expect(commitment1.commitmentHex).not.toBe(commitment2.commitmentHex);
  });

  it('rejects salt that is not exactly 32 bytes', () => {
    expect(() => createVoteCommitment(true, new Uint8Array(31))).toThrow(
      /Salt must be exactly 32 bytes/,
    );
    expect(() => createVoteCommitment(true, new Uint8Array(33))).toThrow(
      /Salt must be exactly 32 bytes/,
    );
    expect(() => createVoteCommitment(true, new Uint8Array(0))).toThrow(
      /Salt must be exactly 32 bytes/,
    );
  });

  it('reveals vote matching the created commitment', () => {
    const commitment = createVoteCommitment(true);
    const reveal = revealVote(true, commitment.salt);

    expect(reveal.voteForDepositor).toBe(true);
    expect(reveal.voteByte).toBe(1);
    expect(reveal.salt).toEqual(commitment.salt);
    expect(reveal.commitmentHex).toBe(commitment.commitmentHex);
    expect(reveal.commitment).toEqual(commitment.commitment);
  });

  it('stores salts locally on JurorClient instance and allows retrieval', () => {
    const jurors = new JurorClient(CONFIG);
    const commitment = jurors.createVoteCommitment(false);

    const storedSalt = jurors.getStoredSalt(commitment.commitmentHex);
    expect(storedSalt).toEqual(commitment.salt);

    const storedSaltFromBytes = jurors.getStoredSalt(commitment.commitment);
    expect(storedSaltFromBytes).toEqual(commitment.salt);

    jurors.clearStoredSalts();
    expect(jurors.getStoredSalt(commitment.commitmentHex)).toBeUndefined();
  });

  it('can be used directly to cast an encrypted vote with JurorClient', async () => {
    const jurors = new JurorClient(CONFIG);
    const commitment = jurors.createVoteCommitment(true);

    const result = await jurors.vote({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      vote: { encrypted: true, ciphertext: commitment.ciphertext },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.encrypted).toBe(true);
    }
  });

  describe('storedSalts cache bounds and eviction', () => {
    it('evicts oldest salt when maxStoredSalts limit is reached', () => {
      const jurors = new JurorClient(CONFIG, { maxStoredSalts: 2 });
      const c1 = jurors.createVoteCommitment(true);
      const c2 = jurors.createVoteCommitment(false);

      expect(jurors.getStoredSalt(c1.commitmentHex)).toBeDefined();
      expect(jurors.getStoredSalt(c2.commitmentHex)).toBeDefined();

      const c3 = jurors.createVoteCommitment(true);
      expect(jurors.getStoredSalt(c1.commitmentHex)).toBeUndefined();
      expect(jurors.getStoredSalt(c2.commitmentHex)).toBeDefined();
      expect(jurors.getStoredSalt(c3.commitmentHex)).toBeDefined();
    });

    it('removes individual stored salt using removeStoredSalt', () => {
      const jurors = new JurorClient(CONFIG);
      const c1 = jurors.createVoteCommitment(true);
      const c2 = jurors.createVoteCommitment(false);

      expect(jurors.removeStoredSalt(c1.commitmentHex)).toBe(true);
      expect(jurors.getStoredSalt(c1.commitmentHex)).toBeUndefined();
      expect(jurors.getStoredSalt(c2.commitmentHex)).toBeDefined();

      expect(jurors.removeStoredSalt(c1.commitmentHex)).toBe(false);
      expect(jurors.removeStoredSalt(c2.commitment)).toBe(true);
      expect(jurors.getStoredSalt(c2.commitmentHex)).toBeUndefined();
    });

    it('evicts expired salts when saltTtlMs is configured', async () => {
      const jurors = new JurorClient(CONFIG, { saltTtlMs: 20 });
      const c1 = jurors.createVoteCommitment(true);

      expect(jurors.getStoredSalt(c1.commitmentHex)).toBeDefined();
      await new Promise((r) => setTimeout(r, 30));

      expect(jurors.getStoredSalt(c1.commitmentHex)).toBeUndefined();
    });
  });

  describe('commit-reveal abstain limitation (Issue #463)', () => {
    it('allows abstain for plaintext vote', async () => {
      const jurors = new JurorClient(CONFIG);
      const result = await jurors.vote({
        disputeId: 'dsp-1',
        jurorAddress: JUROR_ADDRESS,
        vote: { encrypted: false, choice: 'abstain' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.encrypted).toBe(false);
      }
    });

    it('rejects abstain at commitment creation time', () => {
      expect(() =>
        // @ts-expect-error deliberately passing abstain to runtime check
        createVoteCommitment('abstain'),
      ).toThrow(/Commit-reveal voting does not support 'abstain'/);
    });

    it('rejects abstain at vote reveal time', () => {
      const salt = new Uint8Array(32);
      expect(() =>
        // @ts-expect-error deliberately passing abstain to runtime check
        revealVote('abstain', salt),
      ).toThrow(/Commit-reveal voting does not support 'abstain'/);
    });

    it('rejects non-boolean types in commit-reveal helpers', () => {
      expect(() =>
        // @ts-expect-error deliberately passing number
        createVoteCommitment(1),
      ).toThrow(/voteForDepositor must be a boolean/);

      expect(() =>
        // @ts-expect-error deliberately passing number
        revealVote(1, new Uint8Array(32)),
      ).toThrow(/voteForDepositor must be a boolean/);
    });
  });
});

describe('JurorClient.submitReveal (Issue #462)', () => {
  it('accepts a valid reveal with Uint8Array salt (object params) and invokes reveal_vote', async () => {
    const jurors = new JurorClient(CONFIG);
    const commitment = jurors.createVoteCommitment(true);

    const result = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      voteForDepositor: true,
      salt: commitment.salt,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.disputeId).toBe('dsp-1');
      expect(result.data.jurorAddress).toBe(JUROR_ADDRESS);
      expect(result.data.voteForDepositor).toBe(true);
      expect(result.data.txHash).toBe('tx_juror_onchain_abc123');
    }
    expect(invokeModule.invokeContract).toHaveBeenCalledWith(
      expect.anything(),
      'reveal_vote',
      expect.any(Array),
      JUROR_ADDRESS,
    );
  });

  it('propagates invokeContract failure in submitReveal() as { ok: false }', async () => {
    jest.spyOn(invokeModule, 'invokeContract').mockResolvedValueOnce({
      success: false,
      error: 'Reveal rejected: commitment mismatch',
    });
    const jurors = new JurorClient(CONFIG);
    const commitment = jurors.createVoteCommitment(true);

    const result = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      voteForDepositor: true,
      salt: commitment.salt,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/commitment mismatch/);
    }
  });

  it('accepts a valid reveal with hex string salt', async () => {
    const jurors = new JurorClient(CONFIG);
    const commitment = jurors.createVoteCommitment(false);

    const result = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      voteForDepositor: false,
      salt: commitment.saltHex,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.voteForDepositor).toBe(false);
      expect(result.data.txHash).toBe('tx_juror_onchain_abc123');
    }
  });

  it('accepts positional arguments', async () => {
    const jurors = new JurorClient(CONFIG);
    const salt = new Uint8Array(32);

    const result = await jurors.submitReveal('dsp-1', JUROR_ADDRESS, true, salt);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.disputeId).toBe('dsp-1');
      expect(result.data.jurorAddress).toBe(JUROR_ADDRESS);
      expect(result.data.voteForDepositor).toBe(true);
    }
  });

  it('rejects a missing disputeId', async () => {
    const jurors = new JurorClient(CONFIG);
    const salt = new Uint8Array(32);

    const result = await jurors.submitReveal({
      disputeId: '',
      jurorAddress: JUROR_ADDRESS,
      voteForDepositor: true,
      salt,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/disputeId/);
    }
  });

  it('rejects an invalid juror address', async () => {
    const jurors = new JurorClient(CONFIG);
    const salt = new Uint8Array(32);

    const result = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: 'invalid-address',
      voteForDepositor: true,
      salt,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/jurorAddress/);
    }
  });

  it('rejects abstain vote in submitReveal', async () => {
    const jurors = new JurorClient(CONFIG);
    const salt = new Uint8Array(32);

    const result = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      // @ts-expect-error deliberately passing abstain
      voteForDepositor: 'abstain',
      salt,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/abstain/);
    }
  });

  it('rejects non-boolean voteForDepositor', async () => {
    const jurors = new JurorClient(CONFIG);
    const salt = new Uint8Array(32);

    const result = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      // @ts-expect-error deliberately passing string
      voteForDepositor: 'yes',
      salt,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/voteForDepositor must be a boolean/);
    }
  });

  it('rejects missing or empty salt', async () => {
    const jurors = new JurorClient(CONFIG);

    const result = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      voteForDepositor: true,
      // @ts-expect-error deliberately passing empty string
      salt: '',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/salt/i);
    }
  });

  it('rejects salt that is not 32 bytes', async () => {
    const jurors = new JurorClient(CONFIG);

    const resultShort = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      voteForDepositor: true,
      salt: new Uint8Array(16),
    });

    expect(resultShort.ok).toBe(false);
    if (!resultShort.ok) {
      expect(resultShort.error).toMatch(/Salt must be exactly 32 bytes/);
    }

    const resultHex = await jurors.submitReveal({
      disputeId: 'dsp-1',
      jurorAddress: JUROR_ADDRESS,
      voteForDepositor: true,
      salt: 'abcd',
    });

    expect(resultHex.ok).toBe(false);
    if (!resultHex.ok) {
      expect(resultHex.error).toMatch(/Salt must be exactly 32 bytes/);
    }
  });
});


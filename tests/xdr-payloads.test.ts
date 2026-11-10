import { Keypair, xdr } from '@stellar/stellar-sdk';
import './support/scval-matchers';
import {
    buildCreateEscrowArgs,
    buildReleaseArgs,
    buildClaimArgs,
    buildFundArgs,
    buildDisputeArgs,
    buildVoteArgs,
    buildRevealArgs,
} from '../src/contract/build';

const ADDR_A = Keypair.random().publicKey();
const ADDR_B = Keypair.random().publicKey();

describe('contract argument XDR payloads', () => {
    it('buildCreateEscrowArgs returns XDR-decodable ScVal values', () => {
        const args = buildCreateEscrowArgs({
            sender: ADDR_A,
            recipient: ADDR_B,
            amountStroops: 1_000_000n,
            durationBlocks: 42,
        });

        expect(args).toHaveLength(4);
        args.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildReleaseArgs returns XDR-decodable ScVal values', () => {
        const args = buildReleaseArgs('escrow-1', ADDR_A);

        expect(args).toHaveLength(2);
        args.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildClaimArgs returns XDR-decodable ScVal values', () => {
        const args = buildClaimArgs('escrow-1', ADDR_A);

        expect(args).toHaveLength(2);
        args.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildClaimArgs rejects empty or invalid escrowId and invalid claimant address', () => {
        expect(() => buildClaimArgs('', ADDR_A)).toThrow(/escrowId/);
        expect(() => buildClaimArgs('   ', ADDR_A)).toThrow(/escrowId/);
        expect(() => buildClaimArgs('escrow/invalid', ADDR_A)).toThrow(/escrowId/);
        expect(() => buildClaimArgs('escrow-1', 'not-a-valid-address')).toThrow(/claimant/);
    });

    it('buildFundArgs returns XDR-decodable ScVal values without a token address', () => {
        const args = buildFundArgs('escrow-1', ADDR_A, 50_000_000n);

        expect(args).toHaveLength(3);
        args.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildFundArgs includes the token address when provided', () => {
        const args = buildFundArgs('escrow-1', ADDR_A, 50_000_000n, ADDR_B);

        expect(args).toHaveLength(4);
        args.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildFundArgs rejects empty or invalid escrowId, invalid funder, and invalid tokenAddress', () => {
        expect(() => buildFundArgs('', ADDR_A, 50_000_000n)).toThrow(/escrowId/);
        expect(() => buildFundArgs('escrow?bad', ADDR_A, 50_000_000n)).toThrow(/escrowId/);
        expect(() => buildFundArgs('escrow-1', 'bad-funder', 50_000_000n)).toThrow(/funder/);
        expect(() => buildFundArgs('escrow-1', ADDR_A, 50_000_000n, 'bad-token')).toThrow(
            /tokenAddress/,
        );
        expect(() => buildFundArgs('escrow-1', ADDR_A, 50_000_000n, '')).toThrow(/tokenAddress/);
    });

    it('buildDisputeArgs returns XDR-decodable ScVal values', () => {
        const args = buildDisputeArgs('escrow-1', ADDR_A);

        expect(args).toHaveLength(2);
        args.forEach((value) => expect(value).toBeValidScVal());
        expect((args[1] as xdr.ScVal).switch().name).toBe('scvAddress');
    });

    it('buildDisputeArgs encodes the caller as an address with or without reason', () => {
        const withoutReason = buildDisputeArgs('escrow-1', ADDR_A);
        const withReason = buildDisputeArgs('escrow-1', ADDR_A, 'work quality dispute');

        expect(withReason).toHaveLength(3);
        expect((withoutReason[1] as xdr.ScVal).switch().name).toBe('scvAddress');
        expect((withReason[1] as xdr.ScVal).switch().name).toBe('scvAddress');
        withReason.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildVoteArgs returns XDR-decodable ScVal values for a plaintext vote', () => {
        const args = buildVoteArgs('dispute-1', ADDR_A, { encrypted: false, choice: 'approve' });

        expect(args).toHaveLength(4);
        args.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildVoteArgs returns XDR-decodable ScVal values for an encrypted vote', () => {
        const args = buildVoteArgs('dispute-1', ADDR_A, {
            encrypted: true,
            ciphertext: Buffer.from('secret-choice').toString('base64'),
        });

        expect(args).toHaveLength(4);
        args.forEach((value) => expect(value).toBeValidScVal());
    });

    it('buildVoteArgs encodes the encrypted flag distinctly from the vote payload', () => {
        const plaintextArgs = buildVoteArgs('dispute-1', ADDR_A, { encrypted: false, choice: 'reject' });
        const encryptedArgs = buildVoteArgs('dispute-1', ADDR_A, {
            encrypted: true,
            ciphertext: Buffer.from('reject').toString('base64'),
        });

        const plaintextFlag = plaintextArgs[2] as xdr.ScVal;
        const encryptedFlag = encryptedArgs[2] as xdr.ScVal;
        expect(plaintextFlag.b()).toBe(false);
        expect(encryptedFlag.b()).toBe(true);
    });

    it('buildRevealArgs returns XDR-decodable ScVal values', () => {
        const salt = new Uint8Array(32);
        const args = buildRevealArgs('dispute-1', ADDR_A, true, salt);

        expect(args).toHaveLength(4);
        args.forEach((value) => expect(value).toBeValidScVal());

        const voteFlag = args[2] as xdr.ScVal;
        expect(voteFlag.b()).toBe(true);
    });

    it('buildRevealArgs encodes salt hex string into bytes ScVal', () => {
        const saltHex = '00'.repeat(32);
        const args = buildRevealArgs('dispute-1', ADDR_A, false, saltHex);

        expect(args).toHaveLength(4);
        args.forEach((value) => expect(value).toBeValidScVal());

        const voteFlag = args[2] as xdr.ScVal;
        expect(voteFlag.b()).toBe(false);
    });
});


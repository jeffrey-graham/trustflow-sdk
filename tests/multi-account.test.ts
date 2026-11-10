import { AccountManager, ACCOUNT_SNAPSHOT_VERSION } from '../src/accounts';
import type { AccountChangeEvent } from '../src/accounts';
import { TrustFlowClient } from '../src/client';
import { TrustFlowError } from '../src/errors';

const ALICE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const BOB = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';
const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

describe('AccountManager', () => {
  it('starts empty with no active account', () => {
    const accounts = new AccountManager();
    expect(accounts.size).toBe(0);
    expect(accounts.isEmpty).toBe(true);
    expect(accounts.active).toBeNull();
    expect(accounts.activeId).toBeNull();
  });

  it('activates the first account and leaves later ones inactive', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE, label: 'Alice' });
    accounts.add({ address: BOB, label: 'Bob' });

    expect(accounts.active?.address).toBe(ALICE);
    expect(accounts.get(BOB)?.label).toBe('Bob');
  });

  it('defaults the id to the address but allows an explicit id', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE });
    accounts.add({ address: ALICE, id: 'alice-keypair' });

    expect(accounts.size).toBe(2);
    expect(accounts.get(ALICE)?.id).toBe(ALICE);
    expect(accounts.get('alice-keypair')?.address).toBe(ALICE);
  });

  it('switches the active account without touching the others', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE, data: { tab: 'deposits' } });
    accounts.add({ address: BOB, data: { tab: 'jobs' } });

    const alice = accounts.get(ALICE)!;
    accounts.activate(BOB);

    expect(accounts.active?.address).toBe(BOB);
    expect(accounts.get(ALICE)).toBe(alice);
    expect(accounts.get(ALICE)?.data).toEqual({ tab: 'deposits' });
  });

  it('resolves an account by id or by address', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE, id: 'alice' });
    // A custom id must not make the context unreachable by its address.
    expect(accounts.has('alice')).toBe(true);
    expect(accounts.has(ALICE)).toBe(true);
    expect(accounts.get(ALICE)?.id).toBe('alice');
    expect(accounts.activate(ALICE).id).toBe('alice');
    expect(accounts.has('nobody')).toBe(false);
  });

  it('stops resolving a removed account by its old address', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE, id: 'alice' });
    accounts.remove('alice');
    expect(accounts.has(ALICE)).toBe(false);
  });

  it('rejects a blank or malformed address', () => {
    const accounts = new AccountManager();
    expect(() => accounts.add({ address: '' })).toThrow(TrustFlowError);
    expect(() => accounts.add({ address: 'not-a-key' })).toThrow(/valid Stellar public key/);
  });

  it('merges rather than duplicating when the same id is added twice', () => {
    const accounts = new AccountManager();
    accounts.add({ id: 'alice', address: ALICE, data: { a: 1 } });
    accounts.add({ id: 'alice', address: ALICE, label: 'Alice', data: { b: 2 } });

    expect(accounts.size).toBe(1);
    expect(accounts.get('alice')).toMatchObject({
      label: 'Alice',
      data: { a: 1, b: 2 },
    });
  });

  it('merges data on update and lets a value be deleted', () => {
    const accounts = new AccountManager();
    accounts.add({ id: 'alice', address: ALICE, data: { a: 1, b: 2 } });
    accounts.update('alice', { data: { b: 20, c: 3 } });
    expect(accounts.get('alice')?.data).toEqual({ a: 1, b: 20, c: 3 });

    accounts.setData('alice', 'c', undefined);
    expect(accounts.get('alice')?.data).toEqual({ a: 1, b: 20 });
  });

  it('falls back to the first remaining account when the active one is removed', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE });
    accounts.add({ address: BOB });
    accounts.activate(BOB);

    accounts.remove(BOB);
    expect(accounts.active?.address).toBe(ALICE);

    accounts.remove(ALICE);
    expect(accounts.active).toBeNull();
    expect(accounts.size).toBe(0);
  });

  it('emits activated event for fallback account when removing active account (#555)', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE });
    accounts.add({ address: BOB });
    accounts.activate(BOB);

    const events: AccountChangeEvent[] = [];
    accounts.onChange((e) => events.push(e));

    const removed = accounts.remove(BOB);
    expect(removed).toBe(true);
    expect(accounts.active?.address).toBe(ALICE);
    expect(events).toEqual([
      { type: 'removed', account: expect.objectContaining({ address: BOB }) },
      { type: 'activated', account: expect.objectContaining({ address: ALICE }), previousId: BOB },
    ]);
  });

  it('emits deactivated event when removing active account and no accounts remain (#555)', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE });
    expect(accounts.active?.address).toBe(ALICE);

    const events: AccountChangeEvent[] = [];
    accounts.onChange((e) => events.push(e));

    const removed = accounts.remove(ALICE);
    expect(removed).toBe(true);
    expect(accounts.active).toBeNull();
    expect(events).toEqual([
      { type: 'removed', account: expect.objectContaining({ address: ALICE }) },
      { type: 'deactivated', account: null, previousId: ALICE },
    ]);
  });

  it('only emits removed event when removing a non-active account (#555)', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE });
    accounts.add({ address: BOB });
    expect(accounts.active?.address).toBe(ALICE);

    const events: AccountChangeEvent[] = [];
    accounts.onChange((e) => events.push(e));

    const removed = accounts.remove(BOB);
    expect(removed).toBe(true);
    expect(accounts.active?.address).toBe(ALICE);
    expect(events).toEqual([
      { type: 'removed', account: expect.objectContaining({ address: BOB }) },
    ]);
  });

  it('deactivates without unregistering', () => {
    const accounts = new AccountManager();
    accounts.add({ address: ALICE });
    expect(accounts.deactivate()?.address).toBe(ALICE);
    expect(accounts.active).toBeNull();
    expect(accounts.size).toBe(1);
  });

  it('throws ACCOUNT_NOT_FOUND from require for an unknown ref', () => {
    const accounts = new AccountManager();
    expect(() => accounts.require('nope')).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_NOT_FOUND' }),
    );
    expect(() => accounts.require()).toThrow(/No account context is active/);
  });

  it('emits change events and can unsubscribe', () => {
    const accounts = new AccountManager();
    const events: AccountChangeEvent[] = [];
    const off = accounts.onChange((e) => events.push(e.type));

    accounts.add({ id: 'alice', address: ALICE, activate: false });
    accounts.update('alice', { label: 'Alice' });
    accounts.activate(ALICE);
    off();
    accounts.add({ address: BOB });

    expect(events).toEqual(['added', 'updated', 'activated']);
  });

  it('activates the first account automatically, and only the first', () => {
    const accounts = new AccountManager();
    const events: AccountChangeEvent[] = [];
    accounts.onChange((e) => events.push(e.type));

    accounts.add({ address: ALICE });
    accounts.add({ address: BOB });

    expect(accounts.active?.address).toBe(ALICE);
    expect(events).toEqual(['added', 'activated', 'added']);
  });

  it('survives a throwing listener', () => {
    const accounts = new AccountManager();
    accounts.onChange(() => {
      throw new Error('listener exploded');
    });
    expect(() => accounts.add({ address: ALICE })).not.toThrow();
    expect(accounts.size).toBe(1);
  });

  it('stamps lastUsedAt on touch and never mutates the stored context', () => {
    const accounts = new AccountManager();
    const before = accounts.add({ address: ALICE });
    const after = accounts.touch(ALICE);

    expect(before.lastUsedAt).toBeUndefined();
    expect(after.lastUsedAt).toBeGreaterThan(0);
    expect(accounts.get(ALICE)?.lastUsedAt).toBe(after.lastUsedAt);
  });

  it('round-trips through exportState/importState including the active account', () => {
    const accounts = new AccountManager();
    accounts.add({ id: 'alice', address: ALICE, roles: ['depositor'], data: { tab: 'a' } });
    accounts.add({ id: 'bob', address: BOB, apiKey: 'bob-key' });
    accounts.activate('bob');

    const snapshot = accounts.exportState();
    expect(snapshot.version).toBe(ACCOUNT_SNAPSHOT_VERSION);
    expect(snapshot.activeId).toBe('bob');

    const restored = new AccountManager();
    restored.importState(snapshot);
    expect(restored.size).toBe(2);
    expect(restored.active?.id).toBe('bob');
    expect(restored.get('alice')).toMatchObject({
      address: ALICE,
      roles: ['depositor'],
      data: { tab: 'a' },
    });
    expect(restored.get('bob')?.apiKey).toBe('bob-key');
  });

  it('drops an activeId that does not survive the import', () => {
    const accounts = new AccountManager();
    accounts.add({ id: 'alice', address: ALICE });
    const snapshot = { ...accounts.exportState(), activeId: 'ghost' };
    accounts.importState(snapshot);
    expect(accounts.active).toBeNull();
  });

  it('rejects a malformed or unknown-version snapshot', () => {
    const accounts = new AccountManager();
    expect(() => accounts.importState({ version: 1, activeId: null } as never)).toThrow(
      /accounts array/,
    );
    expect(() => accounts.importState(null as never)).toThrow(/accounts array/);
    expect(() =>
      accounts.importState({ version: 99, accounts: [], activeId: null } as never),
    ).toThrow(/unsupported version 99/);
  });
});

describe('TrustFlowClient multi-account integration', () => {
  it('registers accounts from ClientConfig.accounts', () => {
    const client = new TrustFlowClient({
      contractId: CONTRACT,
      accounts: [
        { address: ALICE, label: 'Alice' },
        { address: BOB, label: 'Bob' },
      ],
    });

    expect(client.accounts.size).toBe(2);
    expect(client.activeAccount?.address).toBe(ALICE);
    expect(client.getConfig().accountCount).toBe(2);
    expect(client.getConfig().activeAccount).toBe(ALICE);
  });

  it('behaves as a single-account client when no accounts are configured', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT });
    expect(client.accounts.isEmpty).toBe(true);
    expect(client.activeAccount).toBeNull();
    // Legacy single-account path: resolving without a context is not an error.
    expect(client.resolveAccount()).toBeNull();
    expect(client.getSession()).toBeNull();
  });

  it('switches accounts without rebuilding the shared servers', () => {
    const client = new TrustFlowClient({
      contractId: CONTRACT,
      accounts: [{ address: ALICE }, { address: BOB }],
    });
    const horizon = client.getServer();
    const soroban = client.getSorobanServer();

    client.useAccount(BOB);

    expect(client.activeAccount?.address).toBe(BOB);
    expect(client.getServer()).toBe(horizon);
    expect(client.getSorobanServer()).toBe(soroban);
  });

  it('adds an account after construction and activates it when it is the first', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT });
    const added = client.addAccount({ address: ALICE, label: 'Alice' });
    expect(added.address).toBe(ALICE);
    expect(client.activeAccount?.address).toBe(ALICE);
  });

  it('throws ACCOUNT_NOT_FOUND when a call names an unregistered account', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT });
    expect(() => client.resolveAccount(BOB)).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_NOT_FOUND' }),
    );
    expect(() => client.getAuthHeaders({ account: BOB })).toThrow(
      expect.objectContaining({ code: 'ACCOUNT_NOT_FOUND' }),
    );
  });

  it('scopes auth headers to the named account key', () => {
    const client = new TrustFlowClient({
      contractId: CONTRACT,
      apiKey: 'client-key',
      accounts: [
        { id: 'alice', address: ALICE, apiKey: 'alice-key' },
        { id: 'bob', address: BOB },
      ],
    });

    expect(client.getAuthHeaders({ account: 'alice' })).toMatchObject({
      Authorization: 'Bearer alice-key',
      'X-TrustFlow-Account': 'alice',
    });
    // Bob has no key of his own, so the client-wide key applies — but his
    // account is still identified, and the active account is untouched.
    expect(client.getAuthHeaders({ account: 'bob' })).toMatchObject({
      Authorization: 'Bearer client-key',
      'X-TrustFlow-Account': 'bob',
    });
    expect(client.activeAccount?.address).toBe(ALICE);
  });

  it('isolates sessions per account and clears only the named one', () => {
    const client = new TrustFlowClient({
      contractId: CONTRACT,
      accounts: [
        { id: 'alice', address: ALICE },
        { id: 'bob', address: BOB },
      ],
    });

    client.setSession('alice-token', { account: 'alice' });
    client.setSession('bob-token', { account: 'bob' });

    expect(client.getSession({ account: 'alice' })?.token).toBe('alice-token');
    expect(client.getSession({ account: 'bob' })?.token).toBe('bob-token');

    client.clearSession({ account: 'alice' });
    expect(client.getSession({ account: 'alice' })).toBeNull();
    expect(client.getSession({ account: 'bob' })?.token).toBe('bob-token');
  });

  it('keeps balance cache entries separate per account', async () => {
    const client = new TrustFlowClient({
      contractId: CONTRACT,
      balanceCache: { ttlMs: 60_000 },
      accounts: [
        { id: 'alice', address: ALICE },
        { id: 'bob', address: BOB },
      ],
    });

    const loadAccount = jest
      .spyOn(client.getServer(), 'loadAccount')
      .mockResolvedValue({ balances: [{ asset_type: 'native', balance: '10' }] } as never);

    // Same address, two accounts: each gets its own cache entry, so the second
    // call cannot read the first account's cached balance.
    await client.getBalance(ALICE, { account: 'alice' });
    await client.getBalance(ALICE, { account: 'bob' });
    expect(loadAccount).toHaveBeenCalledTimes(2);

    await client.getBalance(ALICE, { account: 'alice' });
    expect(loadAccount).toHaveBeenCalledTimes(2);
  });

  it('scopes a temporary asAccount switch and restores the previous account', async () => {
    const client = new TrustFlowClient({
      contractId: CONTRACT,
      accounts: [
        { id: 'alice', address: ALICE },
        { id: 'bob', address: BOB },
      ],
    });

    const seen = await client.asAccount('bob', async () => client.activeAccount?.address);
    expect(seen).toBe(BOB);
    expect(client.activeAccount?.address).toBe(ALICE);
  });

  it('restores the previous account even when asAccount throws', async () => {
    const client = new TrustFlowClient({
      contractId: CONTRACT,
      accounts: [
        { id: 'alice', address: ALICE },
        { id: 'bob', address: BOB },
      ],
    });

    await expect(
      client.asAccount('bob', async () => {
        throw new Error('inner failure');
      }),
    ).rejects.toThrow('inner failure');
    expect(client.activeAccount?.address).toBe(ALICE);
  });

  it('returns to no active account when asAccount starts from an empty list', async () => {
    const client = new TrustFlowClient({ contractId: CONTRACT });
    client.addAccount({ address: ALICE, activate: false });
    expect(client.activeAccount).toBeNull();

    await client.asAccount(ALICE, async () => client.activeAccount?.address);
    expect(client.activeAccount).toBeNull();
    expect(client.accounts.size).toBe(1);
  });

  it('forwards account change notifications to client listeners', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT });
    const seen: string[] = [];
    const off = client.onAccountChange((e) => seen.push(e.type));

    client.addAccount({ address: ALICE });
    client.useAccount(ALICE);
    off();
    client.accounts.update(ALICE, { label: 'ignored' });

    expect(seen).toEqual(['added', 'activated']);
  });

  it('stamps lastUsedAt when a call resolves an account', () => {
    const client = new TrustFlowClient({ contractId: CONTRACT, accounts: [{ address: ALICE }] });
    expect(client.accounts.get(ALICE)?.lastUsedAt).toBeUndefined();
    client.getAuthHeaders();
    expect(client.accounts.get(ALICE)?.lastUsedAt).toBeGreaterThan(0);
  });

  it('removes the stale idByAddress entry when an existing id is re-registered with a new address (#600)', () => {
    const mgr = new AccountManager();
    mgr.add({ id: 'wallet-slot', address: ALICE });
    expect(mgr.get(ALICE)?.address).toBe(ALICE);
    expect(mgr.has(ALICE)).toBe(true);

    mgr.add({ id: 'wallet-slot', address: BOB });

    expect(mgr.get(ALICE)).toBeNull();
    expect(mgr.has(ALICE)).toBe(false);
    expect(() => mgr.require(ALICE)).toThrow();
    expect(mgr.get(BOB)).toMatchObject({ id: 'wallet-slot', address: BOB });
    expect(mgr.has(BOB)).toBe(true);
  });
});

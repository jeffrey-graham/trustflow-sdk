# TrustFlow SDK Quick Start

Get up and running in 5 minutes.

## Install

```bash
npm install @trustflow/sdk
# or
yarn add @trustflow/sdk
```

---

## 1. Connect to the Network

```typescript
import { TrustFlowClient } from '@trustflow/sdk';

const client = new TrustFlowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET', // or 'MAINNET'
});

await client.connect();
console.log('Connected to', client.network); // 'TESTNET'
console.log('Config:', client.getConfig());
```

---

## 2. Create an Escrow

### Using `TrustFlowEscrowClient` + `EscrowBuilder` (recommended)

```typescript
import { TrustFlowEscrowClient, EscrowBuilder } from '@trustflow/sdk';

const escrowClient = new TrustFlowEscrowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

const params = new EscrowBuilder()
  .setDepositor('GDEPOSITOR...')
  .setBeneficiary('GBENEFICIARY...')
  .setAmount('50') // XLM
  .setDeadline(17280) // ~1 day in ledgers
  .build();

const result = await escrowClient.createEscrow(params);
if (result.ok) {
  console.log('Escrow ID:', result.data.escrowId);
  console.log('Tx Hash:', result.data.txHash);
} else {
  console.error('Error:', result.error);
}
```

### Creating an escrow without the builder

```typescript
import { TrustFlowEscrowClient } from '@trustflow/sdk';

const escrowClient = new TrustFlowEscrowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

const result = await escrowClient.createEscrow({
  depositor: 'GDEPOSITOR...',
  beneficiary: 'GBENEFICIARY...',
  amountXLM: '50',
  deadlineBlocks: 17280,
});
if (result.ok) console.log('Escrow ID:', result.data.escrowId);
```

---

## 3. Fund an Escrow

```typescript
import { TrustFlowEscrowClient } from '@trustflow/sdk';

const escrowClient = new TrustFlowEscrowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

// Omit the token address for the escrow's native asset; pass the USDC
// Soroban token contract address to fund with USDC instead.
const tokenAddress = process.env.USDC_CONTRACT_ID;
const result = await escrowClient.fund(
  'escrow-1234567890',
  'GDEPOSITOR...',
  500_000_000n,
  tokenAddress,
);
if (result.ok) console.log('Funded! Transaction:', result.data.txHash);
```

### Release an Escrow

```typescript
import { TrustFlowEscrowClient } from '@trustflow/sdk';

const escrowClient = new TrustFlowEscrowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

const result = await escrowClient.releaseEscrow('escrow-1234567890', 'GDEPOSITOR...');
if (result.ok) console.log('Released! Transaction:', result.data.txHash);
```

---

## 4. Check Balance

```typescript
import { TrustFlowClient } from '@trustflow/sdk';

const client = new TrustFlowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
});
await client.connect();

const balance = await client.getBalance('GDEPOSITOR...');
console.log(`Balance: ${balance} XLM`);
```

---

## 5. Raise a Dispute

```typescript
import { DisputeClient } from '@trustflow/sdk';
import type { ContractConfig } from '@trustflow/sdk';

const config: ContractConfig = {
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  apiBaseUrl: process.env.TRUSTFLOW_API_URL!,
  apiKey: process.env.AUTH_TOKEN!,
};
const disputes = new DisputeClient(config);

const result = await disputes.raiseDispute({
  escrowId: 'escrow-1234567890',
  reason: 'Work not delivered as agreed',
  evidence: 'https://evidence.example.com/proof.pdf',
});

if (result.ok) {
  console.log('Dispute raised:', result.data.disputeId);
}

const details = await disputes.getDispute('escrow-1234567890');
if (details.ok) console.log('Dispute details:', details.data);
```

---

## 6. Multi-Sig Escrow (M-of-N)

Collect signatures from multiple approvers before broadcasting:

```typescript
import { MultiSigEscrowClient } from '@trustflow/sdk';
import { Networks } from '@stellar/stellar-sdk';

const client = new MultiSigEscrowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
});
const APPROVER_A = 'GAPPROVER_A...';
const APPROVER_B = 'GAPPROVER_B...';
const SIGNED_XDR_A = process.env.SIGNED_XDR_A!;
const SIGNED_XDR_B = process.env.SIGNED_XDR_B!;

// Register a 2-of-2 release operation
const init = client.initMultiSigOperation({
  escrowId: 'esc-42',
  signers: [APPROVER_A, APPROVER_B],
  threshold: 2,
  operationType: 'release',
  unsignedXdr: process.env.UNSIGNED_RELEASE_XDR!,
  networkPassphrase: Networks.TESTNET,
});

if (!init.ok) throw new Error(init.error);
const { operationId } = init.data;

// Each approver submits their signed XDR independently
client.addSignature({ operationId, signerAddress: APPROVER_A, signedXdr: SIGNED_XDR_A });
client.addSignature({ operationId, signerAddress: APPROVER_B, signedXdr: SIGNED_XDR_B });

// Broadcast once threshold is met
const result = await client.submitWhenReady(operationId, 'https://horizon-testnet.stellar.org');
if (result.ok) console.log('Released! tx:', result.data.txHash);
```

---

## 7. Paginated Gig Listing

```typescript
import { TrustFlowEscrowClient } from '@trustflow/sdk';

const escrowClient = new TrustFlowEscrowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  apiBaseUrl: 'https://api.trustflow.xyz',
  apiKey: process.env.API_KEY,
});

let cursor: string | undefined;
do {
  const page = await escrowClient.getGigs({ cursor, limit: 20, status: 'active' });
  if (!page.ok) { console.error(page.error); break; }
  console.log(page.data.data);
  cursor = page.data.nextCursor ?? undefined;
} while (cursor);
```

## 8. Juror Voting

`JurorClient` supports plaintext and caller-encrypted votes. See the
[README voting guide](../README.md#juror-voting) for the supported vote shapes and encryption details.

```typescript
import { JurorClient } from '@trustflow/sdk';

const jurors = new JurorClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});
const result = await jurors.vote({
  disputeId: 'dsp-1',
  jurorAddress: 'GJUROR...',
  vote: { encrypted: false, choice: 'approve' },
});
if (result.ok) console.log('Vote transaction:', result.data.txHash);
```

## 9. User Profiles

See [ProfileClient in the API reference](./API.md#profileclient) for all profile methods.

```typescript
import { ProfileClient } from '@trustflow/sdk';

const profiles = new ProfileClient(process.env.TRUSTFLOW_API_URL!, process.env.AUTH_TOKEN!);
const result = await profiles.getProfile('GUSER...');
if (result.ok) console.log('Display name:', result.data.displayName);
```

## 10. IPFS Upload and Contract Events

The [README IPFS section](../README.md#ipfs-storage) has upload options and details.
For event subscriptions and parsing, see [EscrowMonitor and event parsing](./API.md#escrowmonitor).

```typescript
import { TrustFlowClient, EscrowMonitor, parseEvents } from '@trustflow/sdk';
import type { RawContractEvent } from '@trustflow/sdk';

const client = new TrustFlowClient({
  contractId: process.env.TRUSTFLOW_CONTRACT_ID!,
  network: 'TESTNET',
  ipfs: { apiKey: process.env.IPFS_API_KEY },
});
const fileBuffer = Buffer.from('evidence');
const upload = await client.storage.upload(fileBuffer, { filename: 'evidence.pdf' });
if (upload.ok) console.log('Uploaded:', upload.data.url);

const rawEvents: RawContractEvent[] = [];
const events = parseEvents(rawEvents, client.contractId);
console.log('Parsed events:', events);

const monitor = new EscrowMonitor();
monitor.on('escrow_released', (event) => console.log('Escrow released:', event.data.escrowId));
```

---

## Environment Variables

```bash
TRUSTFLOW_CONTRACT_ID=C...          # Soroban contract address
TRUSTFLOW_API_URL=https://api.trustflow.xyz # TrustFlow backend URL
API_KEY=your-api-key                # Backend API key for paginated gig listing
AUTH_TOKEN=your-jwt-token           # Bearer token for dispute/profile endpoints
USDC_CONTRACT_ID=C...               # Optional Soroban USDC token contract for funding
IPFS_API_KEY=your-ipfs-api-key      # Optional IPFS upload credential
UNSIGNED_RELEASE_XDR=...            # Base64 XDR for multi-sig flows
SIGNED_XDR_A=...                    # Signed XDR submitted by approver A
SIGNED_XDR_B=...                    # Signed XDR submitted by approver B
```

See [API Reference](./API.md) for the full method list and [examples/](../examples/) for runnable scripts.

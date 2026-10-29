# WaterUptime — Frontend

Web app for **WaterUptime**: an auditable repair workflow for community water points. A reporter logs a fault, a coordinator assigns a technician and a separate verifier, the technician submits repair evidence, the verifier approves it or requests rework, and the coordinator closes the job.

> **Status:** experimental prototype. Synthetic data and Stellar testnet only. All people and facilities in the demo are fictional. No government, NGO, or UNDP partnership is claimed.

Contract: [WaterUptime-SmartContract](https://github.com/WaterUptime/WaterUptime-SmartContract) · Project docs: [WaterUptime](https://github.com/WaterUptime/WaterUptime)

## Two data modes

| Mode | Source | What you can do |
|---|---|---|
| **Demo data** (default) | Synthetic seed, stored in your browser | Act as any role (header selector) and run the full workflow. Every action goes through `src/domain/workflow.ts`, a port of the contract's state machine with the same rules and errors. Nothing is sent on-chain. |
| **Testnet** | The shared testnet contract (`docs/TESTNET.md` in the contract repo) | Without a wallet: read-only view of real on-chain jobs, history and water points. With [Freighter](https://www.freighter.app/) connected: every action your account is allowed to take is a real testnet transaction, signed in the wallet and confirmed on-chain. |

The app always shows which kind of action you are taking:

| | Demo data | Testnet |
|---|---|---|
| Banner | "Prototype with synthetic demo data … nothing is sent on-chain" | "Live Stellar testnet. Actions are real transactions …" |
| Under every action button | "Simulated: runs in your browser, nothing is sent on-chain." | "Real testnet transaction: you will sign it in Freighter." |
| Who you act as | Any participant, chosen in the header | The account selected in Freighter; the contract decides what it may do |
| After an action | "… Simulated in your browser; nothing was sent on-chain." | Progress (simulating → sign in Freighter → confirming), then "… Confirmed on Stellar testnet." with a Stellar Expert link |
| Record of actions | Demo state in `localStorage` | On-chain; the Overview also lists the transactions sent from this browser |

## Pages

- **Overview**: counts by status, open jobs with their next step and who owns it, recent audit activity.
- **Water points**: registry with search and filters, on-chain record and repair history; coordinators can register and deactivate points.
- **Maintenance jobs**: status tabs, lifecycle stepper, role-aware actions (assign/reassign, submit evidence, close, cancel) and the job's audit trail.
- **Verification**: queue of submitted repairs; the assigned verifier approves or returns the job for rework with a reason.
- **Report a fault**: for authorised reporters.

## Signing with a wallet (testnet only)

> **Testnet only.** The app refuses to sign if Freighter is set to any network other than Testnet, and checks again at every signature. Never use an account that holds real funds.

1. Install the [Freighter](https://www.freighter.app/) browser extension and create or import an account.
2. In Freighter, switch the network to **Testnet** and fund the account with Friendbot (Freighter offers this on testnet).
3. Open the app, choose **Testnet** in the header, and click **Connect Freighter**.
4. What you can do depends on your account's role **on the contract**:
   - the contract's admin (coordinator) registers water points, assigns, closes and cancels jobs;
   - accounts the admin has authorised as reporters report faults;
   - the technician and verifier assigned to a job submit evidence and decide on it.

   On the shared contract the admin key is held by the maintainers, so a new account can only read. To try every role, deploy your own instance with `scripts/testnet-demo.sh` in the contract repo, import its four role accounts into Freighter, and point the app at it with `VITE_CONTRACT_ID` in `.env.local`. Switch accounts in Freighter to act as each role.

How it works: `src/data/testnet.ts` builds the call with the Stellar SDK, simulates it (contract errors are shown in plain language and nothing is signed), asks Freighter to sign (`src/data/wallet.ts`), submits it, waits for the ledger to confirm it, and reloads on-chain state. The app never sees a secret key. Descriptions you type are fingerprinted as in demo mode; the text is kept only in this browser's `localStorage`, so other people see the fingerprint, not the text.

### Wallet walkthrough (end-to-end check)

`e2e/wallet-walkthrough.mjs` drives the app in headless Chrome through two jobs on testnet:
- **Job A:** register a water point, report, assign, submit, return for rework, resubmit, approve, close.
- **Job B:** report and assign, then an unauthorised submit that the contract rejects, then cancel the job and deactivate the water point.

It also checks four things:
- demo actions send nothing;
- a wallet on the wrong network is refused;
- a declined signature changes nothing;
- each transaction is confirmed on testnet, checked independently over RPC.

```bash
npm run dev                                     # in another terminal
KEY_PREFIX=wu CHROME=/path/to/chrome npm run e2e:wallet
```

It needs four funded Stellar CLI identities (`<prefix>-admin`, `-reporter`, `-technician`, `-verifier`) that hold those roles on the target contract. The script's wallet is a **stand-in** that answers Freighter's page messages and signs with those keys inside the Node process; the app runs its real Freighter code path. It does not test the Freighter extension itself, so also try the steps above by hand with Freighter before a release.

## Data handling

- Only opaque IDs, salted SHA-256 fingerprints (`src/domain/hash.ts`), addresses and timestamps correspond to on-chain data.
- Forms warn against entering names, phone numbers or exact locations; the demo stores LGA-level locality only.
- People are shown by name and role, with the address as secondary information.
- The demo's off-chain records, and the descriptions you write in testnet mode, live in `localStorage` for convenience only. A real deployment needs an access-controlled evidence store.

## Development

Requires Node 24.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # workflow state-machine tests
npm run typecheck
npm run build
npm run e2e:wallet # testnet walkthrough, see above
```

Optional: copy `.env.example` to `.env.local` to point Testnet mode at a different contract. **Testnet only.**

The Stellar SDK is loaded only when Testnet mode is opened, which keeps the default bundle small for low-bandwidth connections.

## Layout

```text
src/
├── domain/       # contract-mirroring types, state machine, error messages, hashing
├── data/         # demo seed, app store, testnet reads and signed writes, Freighter wallet, config
├── components/   # layout shell, shared UI, job timeline and stepper, wallet and transaction UI
└── pages/        # Overview, WaterPoints, Jobs, Verification, ReportFault
e2e/              # testnet wallet walkthrough
```

When the contract interface changes, update `src/domain/types.ts`, `src/domain/workflow.ts` (and its tests) and `src/domain/errors.ts` together.

## License

[MIT](LICENSE)

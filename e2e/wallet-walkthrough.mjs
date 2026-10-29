// End-to-end testnet walkthrough: drives the app in Chrome through a full
// repair job, with every action signed by a wallet and confirmed on testnet.
//
// The wallet is a stand-in that answers the same window.postMessage requests
// as the Freighter extension's content script, so the app's real Freighter
// code path runs unchanged. Secret keys stay in this Node process and are read
// from the Stellar CLI; the page only ever receives signed transactions.
//
// Usage (testnet only, see README "Wallet walkthrough"):
//   npm run dev                       # in another terminal
//   KEY_PREFIX=wu node e2e/wallet-walkthrough.mjs
//
// Needs four funded Stellar CLI identities, <prefix>-admin (the contract's
// admin), <prefix>-reporter (an authorised reporter), <prefix>-technician and
// <prefix>-verifier, and the app pointed at that contract (VITE_CONTRACT_ID).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Keypair, Networks, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { chromium } from "playwright-core";

const APP = process.env.APP_URL ?? "http://localhost:5173";
const PREFIX = process.env.KEY_PREFIX ?? "wu";
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const OUT = process.env.OUT_DIR ?? "e2e/output";
const CONTRACT = process.env.VITE_CONTRACT_ID ?? "CDO5G5UK4YLRCBXWJI7GSJYTPXZSZNCAQ4ILAKZHYUBA64QWWCUTF22Z";
const RPC = new rpc.Server(process.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org");

const secret = (name) => execFileSync("stellar", ["keys", "secret", `${PREFIX}-${name}`], { encoding: "utf8" }).trim();
const keys = Object.fromEntries(["admin", "reporter", "technician", "verifier"].map((r) => [r, Keypair.fromSecret(secret(r))]));

// ---- Wallet stand-in state (lives in Node) ----
const wallet = { selected: keys.admin, network: Networks.TESTNET, rejectNext: false, signed: [] };

function walletReply(req) {
  switch (req.type) {
    case "REQUEST_CONNECTION_STATUS":
      return { isConnected: true };
    case "REQUEST_ACCESS":
    case "REQUEST_PUBLIC_KEY":
      return { publicKey: wallet.selected.publicKey() };
    case "REQUEST_NETWORK_DETAILS":
      return {
        networkDetails: {
          network: wallet.network === Networks.TESTNET ? "TESTNET" : "PUBLIC",
          networkUrl: "",
          networkPassphrase: wallet.network,
        },
      };
    case "SUBMIT_TRANSACTION": {
      const tx = TransactionBuilder.fromXDR(req.transactionXdr, req.networkPassphrase);
      const op = tx.operations[0];
      const fn = op?.func?.toJSON?.().invoke_contract?.function_name ?? op?.type;
      if (wallet.rejectNext) {
        wallet.rejectNext = false;
        wallet.signed.push({ fn, signer: wallet.selected.publicKey(), rejected: true });
        return { signedTransaction: "", signerAddress: "", apiError: { code: -4, message: "The user rejected this request." } };
      }
      // A real wallet refuses to sign for an account it does not hold.
      if (tx.source !== wallet.selected.publicKey()) {
        return { apiError: { code: -1, message: "Source account is not the selected account." } };
      }
      tx.sign(wallet.selected);
      wallet.signed.push({ fn, signer: wallet.selected.publicKey(), hash: Buffer.from(tx.hash()).toString("hex") });
      return { signedTransaction: tx.toXDR(), signerAddress: wallet.selected.publicKey() };
    }
    default:
      return { apiError: { code: -1, message: `Unsupported request ${req.type}` } };
  }
}

// Runs in the page, in place of Freighter's content script.
const contentScript = () => {
  window.addEventListener("message", async (event) => {
    const req = event.data;
    if (event.source !== window || req?.source !== "FREIGHTER_EXTERNAL_MSG_REQUEST") return;
    const reply = await window.__walletStandIn(req);
    window.postMessage({ source: "FREIGHTER_EXTERNAL_MSG_RESPONSE", messagedId: req.messageId, ...reply }, window.location.origin);
  });
};

// ---- Helpers ----
mkdirSync(OUT, { recursive: true });
const log = [];
const step = (msg) => {
  log.push(msg);
  console.log(`• ${msg}`);
};
let shot = 0;
const snap = async (page, name) => page.screenshot({ path: `${OUT}/${String(++shot).padStart(2, "0")}-${name}.png`, fullPage: true });

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

async function go(page, path) {
  // Client-side navigation keeps the app's in-memory state.
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

async function useAccount(page, role) {
  wallet.selected = keys[role];
  // The app re-reads the Freighter account when the window regains focus.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByTestId("wallet-address").filter({ hasText: keys[role].publicKey().slice(-4) }).waitFor();
}

/**
 * Wait until the wallet has signed a new transaction and the app shows its
 * confirmation notice, then check it on-chain independently. Returns the hash.
 */
const seen = new Set();
async function confirmed(page, text) {
  const deadline = Date.now() + 90_000;
  let last;
  while (!(last = wallet.signed.at(-1)) || !last.hash || seen.has(last.hash)) {
    assert(Date.now() < deadline, `no new signature for "${text}"`);
    await page.waitForTimeout(250);
  }
  seen.add(last.hash);
  const notice = page.getByRole("status").filter({ hasText: text }).filter({ has: page.locator(`a[href$="${last.hash}"]`) });
  await notice.waitFor({ timeout: 90_000 });
  assert((await notice.innerText()).includes("Confirmed on Stellar testnet"), "notice says confirmed on testnet");
  const onChain = await RPC.getTransaction(last.hash);
  assert(onChain.status === "SUCCESS", `${last.hash} is ${onChain.status} on testnet`);
  step(`  ↳ ${last.fn} signed by ${role(last.signer)}, confirmed in ledger ${onChain.ledger}: ${last.hash}`);
  return last.hash;
}

const role = (address) => Object.entries(keys).find(([, k]) => k.publicKey() === address)?.[0] ?? address;

async function jobStatus(page) {
  return (await page.locator("main").getByText(/Workflow progress/).locator("..").innerText()).split("\n").pop();
}

// ---- Walkthrough ----
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
await context.exposeFunction("__walletStandIn", (req) => {
  try {
    return walletReply(req);
  } catch (e) {
    console.error("wallet stand-in:", e);
    return { apiError: { code: -1, message: String(e) } };
  }
});
await context.addInitScript(contentScript);
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
const rpcSends = [];
page.on("request", (r) => {
  if (r.method() === "POST" && r.postData()?.includes('"sendTransaction"')) rpcSends.push(r.url());
});

try {
  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 1. Demo mode: actions are simulated and nothing is sent.
  step("Demo mode: close a verified demo job as the coordinator");
  await go(page, "/jobs?status=Verified");
  await page.getByRole("button", { name: "Close job" }).first().click();
  await page.getByRole("status").filter({ hasText: "Simulated in your browser; nothing was sent on-chain." }).waitFor();
  assert(rpcSends.length === 0, "demo mode sent no transaction");
  step("  ↳ notice says it was simulated; no sendTransaction request left the browser");
  await snap(page, "demo-simulated");

  // 2. Testnet, read-only until a wallet connects.
  step("Testnet mode: read-only until a wallet is connected");
  await page.getByRole("radio", { name: "Testnet" }).first().click();
  await page.getByText("Live Stellar testnet, read-only.").waitFor({ timeout: 60_000 });

  // A wallet on the wrong network is refused before anything is signed.
  wallet.network = Networks.PUBLIC;
  await page.getByRole("button", { name: "Connect Freighter" }).click();
  await page.getByRole("alert").filter({ hasText: "Switch it to Testnet" }).waitFor();
  step("  ↳ a wallet set to the public network is refused");
  wallet.network = Networks.TESTNET;

  await page.getByRole("button", { name: "Connect Freighter" }).click();
  await page.getByText("Actions are real transactions").waitFor();
  await snap(page, "testnet-connected");
  step(`Connected as admin ${keys.admin.publicKey()}`);

  // 3. Admin registers a water point.
  const code = `WP-E2E-${Date.now().toString().slice(-5)}`;
  step(`Admin registers water point ${code}`);
  await go(page, "/water-points");
  await page.getByRole("button", { name: "Register water point" }).click();
  await page.getByLabel("Code").fill(code);
  await page.getByLabel("Facility name").fill("Synthetic test handpump");
  await page.getByLabel("LGA / locality").fill("Testville");
  await page.getByText("Real testnet transaction: you will sign it in Freighter.").first().waitFor();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByTestId("pending-stage").waitFor();
  await confirmed(page, `${code} registered.`);

  // 4. Reporter reports a fault on it.
  step("Reporter reports a fault");
  await useAccount(page, "reporter");
  await go(page, "/report");
  await page.getByRole("combobox", { name: "Water point" }).selectOption({ label: `${code} · Synthetic test handpump (Testville)` });
  await page.getByLabel("What is wrong?").fill("Handle loose, low flow (synthetic test)");
  await page.getByRole("button", { name: "Submit report" }).click();
  await confirmed(page, "Fault reported.");
  await page.waitForURL(/\/jobs\/\d+$/);
  const jobId = Number(page.url().split("/").pop());
  assert((await jobStatus(page)).includes("Reported"), "job shows Reported");
  step(`  ↳ job #${jobId} created; the page shows status Reported`);

  // 5. A declined signature changes nothing.
  step("Admin assigns, but declines the first signature request");
  await useAccount(page, "admin");
  await go(page, `/jobs/${jobId}`);
  const assign = async () => {
    await page.getByLabel("Technician").selectOption({ label: "Testnet technician" });
    await page.getByLabel("Independent verifier").selectOption({ label: "Testnet verifier" });
    await page.getByRole("button", { name: "Assign job" }).click();
  };
  wallet.rejectNext = true;
  await assign();
  await page.getByRole("alert").filter({ hasText: "Signature not given" }).waitFor();
  assert((await jobStatus(page)).includes("Reported"), "job still Reported after a declined signature");
  step("  ↳ error shown, job still Reported");

  step("Admin assigns technician and verifier");
  await assign();
  await confirmed(page, `Job #${jobId} assigned.`);
  assert((await jobStatus(page)).includes("Assigned"), "job shows Assigned");

  // 6. Technician submits evidence.
  step("Technician submits repair evidence");
  await useAccount(page, "technician");
  await page.getByLabel("Work performed").fill("Replaced handle bolts and cup seals (synthetic)");
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await confirmed(page, `Repair evidence submitted for job #${jobId}.`);

  // 7. Verifier returns it for rework.
  step("Verifier returns the repair for rework");
  await useAccount(page, "verifier");
  await go(page, `/verification?job=${jobId}`);
  await page.getByLabel("Reason").selectOption("Incomplete evidence");
  await page.getByLabel(/Instructions for/).fill("Add a 10-minute flow test result.");
  await page.getByRole("button", { name: "Return for rework" }).click();
  await confirmed(page, `Job #${jobId} returned for rework.`);

  // 8. Technician resubmits.
  step("Technician resubmits with the flow test");
  await useAccount(page, "technician");
  await go(page, `/jobs/${jobId}`);
  assert((await jobStatus(page)).includes("Rework requested"), "job shows Rework requested");
  await page.getByLabel("Work performed").fill("Flow test done: 10 minutes, steady flow, no leaks (synthetic)");
  await page.getByRole("button", { name: "Submit for verification" }).click();
  await confirmed(page, `Repair evidence submitted for job #${jobId}.`);

  // 9. Verifier approves.
  step("Verifier approves");
  await useAccount(page, "verifier");
  await go(page, `/verification?job=${jobId}`);
  await page.getByRole("button", { name: "Approve repair" }).waitFor();
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByLabel("Verification notes").fill("Flow test result checked.");
  await page.getByRole("button", { name: "Approve repair" }).click();
  await confirmed(page, `Repair approved for job #${jobId}.`);

  // 10. Admin closes.
  step("Admin closes the job");
  await useAccount(page, "admin");
  await go(page, `/jobs/${jobId}`);
  await page.getByRole("button", { name: "Close job" }).click();
  await confirmed(page, `Job #${jobId} closed.`);
  assert((await jobStatus(page)).includes("Closed"), "job shows Closed");
  await snap(page, "job-closed");

  // 11. The page shows what the contract recorded.
  const events = Number(/(\d+) events/.exec(await page.locator("main").getByText(/^\d+ events$/).innerText())?.[1]);
  assert(events === 7, `audit trail shows 7 events (got ${events})`);
  step(`  ↳ job page shows Closed with ${events} audit events`);

  // Reload from scratch: state comes from the chain, not from the page's memory.
  await page.reload();
  await go(page, `/jobs/${jobId}`);
  await page.getByText("Workflow progress").waitFor({ timeout: 60_000 });
  assert((await jobStatus(page)).includes("Closed"), "after a reload the job is still Closed (read from chain)");
  step("After a full reload the job is still Closed, read back from the contract");

  // 12. Second job: an unauthorised action is rejected in plain language,
  // then the job is cancelled and the water point deactivated.
  step("Reporter reports a second fault on the same water point");
  await useAccount(page, "reporter");
  await go(page, "/report");
  await page.getByRole("combobox", { name: "Water point" }).selectOption({ label: `${code} · Synthetic test handpump (Testville)` });
  await page.getByLabel("What is wrong?").fill("Duplicate report (synthetic test)");
  await page.getByRole("button", { name: "Submit report" }).click();
  await confirmed(page, "Fault reported.");
  await page.waitForURL(/\/jobs\/\d+$/);
  const jobB = Number(page.url().split("/").pop());

  await useAccount(page, "admin");
  await assign();
  await confirmed(page, `Job #${jobB} assigned.`);

  step("Technician opens the job; meanwhile the admin reassigns it to another account from the CLI");
  await useAccount(page, "technician");
  await page.getByLabel("Work performed").fill("Should be rejected");
  execFileSync("stellar", [
    "contract", "invoke", "--id", CONTRACT, "--source", `${PREFIX}-admin`, "--network", "testnet", "--",
    "assign_job", "--job_id", String(jobB), "--technician", keys.reporter.publicKey(), "--verifier", keys.verifier.publicKey(),
  ], { stdio: "ignore" });
  const signedBefore = wallet.signed.length;
  await page.getByRole("button", { name: "Submit for verification" }).click();
  const rejection = page.getByRole("alert").filter({ hasText: "Only the technician assigned to this job can submit repair evidence." });
  await rejection.waitFor({ timeout: 60_000 });
  assert(!(await rejection.innerText()).includes("Error(Contract"), "no raw contract error shown");
  assert(wallet.signed.length === signedBefore, "the wallet was never asked to sign the rejected action");
  step("  ↳ simulation rejected it (NotAssignedTechnician); plain-language error shown; nothing signed or sent");
  await snap(page, "unauthorised-rejected");

  step("Admin cancels the second job");
  await useAccount(page, "admin");
  await go(page, `/jobs/${jobB}`);
  await page.getByRole("button", { name: "Cancel this job…" }).click();
  await page.getByLabel("Reason").fill("Duplicate report (synthetic test)");
  await page.getByRole("button", { name: "Cancel job", exact: true }).click();
  await confirmed(page, `Job #${jobB} cancelled.`);
  assert((await jobStatus(page)).includes("Cancelled"), "job B shows Cancelled");

  step("Admin deactivates the test water point");
  await go(page, "/water-points");
  await page.getByRole("button", { name: `View ${code}` }).click();
  await page.getByRole("button", { name: "Deactivate" }).click();
  await confirmed(page, "Water point deactivated.");
  await page.getByText("No (inactive)").waitFor();

  await go(page, "/");
  await page.getByTestId("tx-log").waitFor();
  const signed = wallet.signed.filter((s) => !s.rejected);
  const logged = await page.getByTestId("tx-log").locator("li").count();
  assert(logged === signed.length, `transaction log lists ${signed.length} transactions (got ${logged})`);
  await snap(page, "overview-tx-log");

  writeFileSync(
    `${OUT}/walkthrough.json`,
    JSON.stringify({ app: APP, contract: CONTRACT, jobs: [jobId, jobB], waterPoint: code, transactions: signed, rpcSendRequests: rpcSends.length, consoleErrors }, null, 2),
  );
  assert(rpcSends.length === signed.length, "one sendTransaction per signed action");
  step(`Done: ${signed.length} signed transactions, ${rpcSends.length} submissions, ${consoleErrors.length} console errors`);
  if (consoleErrors.length) console.log(consoleErrors);
} catch (e) {
  await snap(page, "failure").catch(() => {});
  throw e;
} finally {
  await browser.close();
}

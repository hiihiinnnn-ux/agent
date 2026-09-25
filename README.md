# ZainCash Conversational Wallet Agent

A guarded, local Iraqi-Arabic wallet-agent demo. This first slice turns a small set of written or spoken-in-text requests into structured wallet actions, asks follow-up questions when a recipient or bill target is unclear, shows the complete action for confirmation, and executes only against a local simulator.

## Run the demo

Requires Node.js 20 or newer. No package installation or external service credentials are needed.

```sh
node src/demo.js
```

The demo shows `دز خمسين لأحمد`, asks which Ahmed, presents the resolved transfer, and runs it only after `اي`. To chat interactively instead:

```sh
node src/cli.js
```

Try `رصيدي`, `ادفع فاتورة الكهرباء`, and `دز 999999 لأحمد علي`. Type `خروج` to leave. All balances, contacts, billers, invoices, and transaction results are simulated. Nothing connects to ZainCash or moves real money.

## Current design

- `src/intent-parser.js` extracts transfer, bill-payment, and balance-check intents from supported Iraqi Arabic phrases.
- `src/agent.js` holds the conversation state, requests missing details, resolves duplicate contacts, validates the action, and requires an explicit `اي` before execution. Unknown confirmation replies do not execute.
- `src/wallet-simulator.js` is the controlled tool boundary for this demo. It checks recipients, exact bill amounts, available balance, and an idempotency key before changing the simulated ledger.
- `src/audit-logger.js` appends JSONL events to `data/audit.jsonl`. It records lifecycle and transaction metadata, not the user's raw message.
- `src/normalize.js` normalizes Arabic characters/digits, recognizes a limited number vocabulary, and formats IQD amounts.

This is a deterministic parser baseline, not a trained model or a general-purpose Iraqi Arabic LLM. It is deliberately narrow and asks when it cannot extract a supported action safely.

## What is still needed

The repository did not include any of these, so live or measured behavior is not claimed:

1. An AI model/provider choice and credentials, if you want model-based intent extraction; the current baseline can remain as a safety validator around it.
2. ZainCash sandbox API documentation and credentials, plus the required authentication and transaction contracts. The simulator should be replaced behind the wallet-tool boundary only after those are available.
3. The real account/contact/biller source and bill inquiry rules, including which identifiers can safely appear in confirmation summaries.
4. Your supported Iraqi Arabic phrasing and currency rules. In particular, confirm whether bare amounts such as `خمسين` always mean 50 IQD or have an implied denomination in your intended UX.
5. At least 50 labeled Iraqi Arabic evaluation requests with expected intent, entities, clarification behavior, tool action, and safety outcome. The pitch metrics remain targets until that set is run and results are measured.
6. A deployment/session identity design and durable storage for pending confirmations, idempotency keys, balances, and tamper-evident audit events. Current state is in memory; the JSONL log is a local development artifact.

## Safety boundary

Only the exact positive replies `اي`, `اي نعم`, `نعم`, `اكد`, `تاكيد`, `اوافق`, `موافق`, `yes`, or `confirm` confirm an action. Every transfer and bill payment must pass the simulator's server-side-style validation again at execution time. A cancelled, malformed, ambiguous, invalid, or insufficient-funds action fails without changing the wallet balance.

Before any real-money integration, the confirmation and validation rules must be enforced by a trusted backend that authenticates the user, binds confirmation to the exact displayed action, expires pending actions, and performs idempotent transactions atomically.

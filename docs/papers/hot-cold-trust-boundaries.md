# Hot/Cold Trust Boundaries: Minimizing Attack Surface Through Architectural Separation

**Authors**: Faraday1, JARVIS
**Date**: March 2026
**Affiliation**: VibeSwap Research
**Status**: Working Paper

---

## Abstract

Frontend security in decentralized finance is an afterthought. Most protocols treat the entire frontend as a trusted surface, mixing contract interaction code with UI rendering code in an undifferentiated tangle of components, hooks, and utilities. The result is an audit surface the size of the entire application -- every file is a potential vector for fund theft.

We present **Hot/Cold Trust Boundary Architecture**: a strict architectural separation where code that interacts with smart contracts ("hot") is isolated from code that does not ("cold"). The audit surface shrinks from the entire application to a single directory. We formalize the pattern, derive it from Glynn's 2018 wallet security research on key management and cold storage principles, and demonstrate its application in VibeSwap's 106-file React frontend serving an omnichain DEX with commit-reveal batch auctions.

The core insight is a knowledge primitive that generalizes beyond DeFi: *the attack surface of a system is determined by how much code CAN interact with the critical resource, not how much code DOES. Minimize the CAN.*

**Keywords**: frontend security, DeFi, attack surface reduction, trust boundaries, architectural isolation, supply chain defense

---

## 1. Introduction

Between 2021 and 2025, DeFi protocols lost over $7 billion to exploits. The industry response has been predictable: more smart contract audits, more formal verification, more bug bounties on Solidity code. This response is correct but incomplete. It addresses the vault door while ignoring the lobby.

Frontend attacks -- DNS hijacking, malicious npm packages, cross-site scripting, supply chain compromises -- have emerged as the dominant exploit vector for mature protocols whose contracts have already been audited. The BadgerDAO frontend attack (2021, $120M), the Curve DNS hijack (2022), the Ledger Connect Kit supply chain compromise (2023, $600K+), and the Balancer DNS attack (2023) all share a common trait: the smart contracts were fine. The frontend was the point of failure.

The reason is architectural. A typical DeFi frontend is a React or Next.js application with 50-200 components. Any of those components can import `ethers.js`, construct a transaction, and interact with contracts. The audit surface is not "the three files that actually call contracts." The audit surface is "every file that *could* call contracts" -- which is every file in the project.

This paper proposes a solution rooted not in new technology but in old principle: the same separation of concerns that makes cold storage wallets secure can make frontend architectures secure. We call it Hot/Cold Trust Boundary Architecture.

---

## 2. The Problem: Frontend as Attack Vector

### 2.1 The Threat Landscape

DeFi frontends face five primary attack vectors, each of which exploits the absence of internal trust boundaries:

**DNS Hijacking.** An attacker compromises the DNS records for a protocol's domain, redirecting users to a malicious frontend that appears identical to the legitimate one. The malicious frontend modifies transaction parameters -- changing recipient addresses, inflating approval amounts, or inserting additional transactions. Because the user sees the familiar UI, they sign without suspicion.

**Malicious npm Packages.** The JavaScript ecosystem's dependency model is a supply chain nightmare. A typical React DeFi frontend has 800-1,500 transitive dependencies. An attacker who compromises a single dependency -- even a utility library for string formatting or date parsing -- gains code execution in the browser. If that code execution context has access to `ethers.js` or `web3.js`, the attacker can construct and submit transactions.

**Cross-Site Scripting (XSS).** If user-controlled input is rendered without sanitization, an attacker can inject JavaScript that executes in the context of the application. In a conventional DeFi frontend, that injected code has the same privileges as any other code in the application: full access to the wallet provider, full ability to construct transactions.

**Supply Chain Attacks on Build Tools.** The build pipeline (Webpack, Vite, Babel, PostCSS) processes every source file. A compromised build plugin can inject code into any output bundle. The injected code inherits the full privilege set of the application.

**Insider Threats and Compromised Developer Machines.** A developer whose machine is compromised (or a malicious insider) can modify any file in the codebase. In an undifferentiated architecture, a one-line change to a seemingly innocuous UI component can introduce a transaction drain.

### 2.2 The Root Cause: Undifferentiated Privilege

All five vectors share a structural root cause: **undifferentiated privilege**. In a conventional frontend architecture, every file in the project has equal access to the critical resource (the user's wallet and the ability to construct transactions). There is no architectural distinction between code that *needs* to interact with contracts and code that merely *can*.

Consider a typical DeFi frontend directory structure:

```
src/
├── components/
│   ├── Header.jsx          # UI chrome
│   ├── SwapForm.jsx         # Calls contracts
│   ├── Footer.jsx           # Static text
│   ├── TokenSelector.jsx    # UI component
│   ├── PriceChart.jsx       # Data visualization
│   └── TransactionModal.jsx # Calls contracts
├── hooks/
│   ├── useWallet.js         # Wallet connection
│   ├── useSwap.js           # Contract interaction
│   ├── useTheme.js          # Visual preference
│   └── useAnalytics.js      # Tracking
├── utils/
│   ├── format.js            # Number formatting
│   ├── contracts.js         # ABI + addresses
│   └── constants.js         # Config values
└── pages/
    ├── Swap.jsx             # Mixes UI + contracts
    ├── Pool.jsx             # Mixes UI + contracts
    └── Bridge.jsx           # Mixes UI + contracts
```

In this structure, `Footer.jsx` has the same import privileges as `SwapForm.jsx`. A compromised npm package loaded by `PriceChart.jsx` for charting has the same access to `ethers.js` as the swap execution logic. The audit surface is 15+ files. The actual contract interaction surface is 4-5 files. The gap between "does interact" and "can interact" is the attack surface.

### 2.3 Quantifying the Problem

Let `S` be the set of all source files in a frontend. Let `H \subseteq S` be the subset that actually interacts with contracts. Let `A \subseteq S` be the subset that *can* interact with contracts (has import access to web3 libraries).

In a conventional architecture: `A = S`. Every file can import `ethers.js`.

The **attack surface ratio** is:

```
R = |A| / |H|
```

For a typical DeFi frontend with 100 files and 8 contract-interacting files:

```
R = 100 / 8 = 12.5
```

The audit surface is 12.5 times larger than necessary. Every file that does not need contract access but has it represents unnecessary risk.

**The goal of Hot/Cold Trust Boundary Architecture is to make `A = H`, driving `R` to 1.**

---

## 3. Wallet Security Foundations

### 3.1 Origins: The 2018 Key Management Paper

The architectural pattern we propose is not novel in principle. It is a direct application of cold storage wallet design principles to frontend code organization. These principles were formalized in Glynn's 2018 research on wallet security fundamentals, which established seven axioms for secure key management:

1. **"Your keys, your bitcoin. Not your keys, not your bitcoin."** Users must control their own private keys. Systems that custody keys on centralized servers create single points of compromise.

2. **Cold storage is king.** Keys that never touch a network cannot be stolen remotely. The most secure key is the one that has never been online.

3. **Web wallets are the least secure.** Any system where keys are accessible to a web browser inherits the full threat surface of the browser, the network, and every dependency loaded into that context.

4. **Centralized honeypots attract attackers.** It is more profitable for an attacker to target a centralized service holding many wallets than to target individual users. Concentration of value attracts concentration of effort.

5. **Private keys must be encrypted and backed up.** Recovery mechanisms must be user-controlled, not custodial. The user is the root of trust.

6. **Separation of concerns.** Different wallets for different purposes. A spending wallet should hold only what is needed for daily use. Long-term holdings belong in cold storage. Limit exposure by limiting what is at risk.

7. **Offline generation is safest.** Key generation should occur offline when possible. Minimize network exposure during sensitive operations.

### 3.2 From Key Architecture to Code Architecture

Axiom 6 -- separation of concerns -- is the bridge between wallet security and frontend architecture. In wallet design, the insight is: *separate the code that handles keys from the code that handles everything else*. A hardware wallet is a physical manifestation of this principle: the signing logic runs on an isolated device with a minimal attack surface, connected to the broader system only through a narrow, well-defined interface.

The analogous insight for frontend architecture: *separate the code that constructs transactions from the code that renders the interface*. The "hot zone" is the software equivalent of a hardware wallet -- a minimal, auditable surface that handles the dangerous operations, connected to the rest of the application through a narrow, well-defined interface.

Axiom 4 -- centralized honeypots -- also applies. An undifferentiated frontend is a honeypot: compromise any file, access all funds. A separated frontend is distributed: compromise a cold zone file, access nothing.

Axiom 2 -- cold storage is king -- maps directly: code that never touches web3 cannot be used to steal funds, regardless of how thoroughly it is compromised. The cold zone is "cold" in exactly the same sense as a cold wallet. It is offline with respect to the critical resource.

### 3.3 The Generalized Security Primitive

The wallet security axioms, when abstracted, yield a general security primitive:

> **Separation Primitive**: For any system with a critical resource `R`, identify the minimal set of code `M` that must interact with `R`. Architect the system so that `M` is isolated, auditable, and the only code with access to `R`. All other code interacts with `R` exclusively through `M`.

This primitive applies to:

| Domain | Critical Resource | Hot Zone | Cold Zone |
|--------|-------------------|----------|-----------|
| Wallets | Private keys | Signing device | Display, UI |
| DeFi frontends | Contract interaction | `blockchain/` | `ui/` |
| Backend services | Database credentials | Data access layer | Business logic |
| CI/CD pipelines | Deploy keys | Deploy scripts | Build scripts |
| Secret management | API keys | Vault client | Application code |

The pattern is always the same: minimize the code that CAN touch the critical resource.

---

## 4. The Architecture

### 4.1 Zone Definitions

Hot/Cold Trust Boundary Architecture divides a DeFi frontend into three zones with strict import rules:

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND APPLICATION                   │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  HOT ZONE    │  │  WARM ZONE   │  │  COLD ZONE   │   │
│  │  blockchain/ │  │  app/        │  │  ui/         │   │
│  │              │  │              │  │              │   │
│  │  - ABIs      │←─│  - Pages     │──→  - Components│   │
│  │  - Gateway   │  │  - Providers │  │  - Layouts   │   │
│  │  - Hooks     │  │              │  │  - Utils     │   │
│  │  - Validation│  │              │  │  - Styles    │   │
│  │              │  │              │  │              │   │
│  │  CAN touch   │  │  Connects    │  │  CANNOT      │   │
│  │  contracts   │  │  hot to cold │  │  touch       │   │
│  │              │  │              │  │  contracts   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                           │
│  Import direction: Cold ← Warm → Hot                     │
│  Cold NEVER imports from Hot                             │
│  Hot NEVER imports from Cold                             │
└─────────────────────────────────────────────────────────┘
```

**Hot Zone** (`blockchain/`): All code that interacts with smart contracts. This includes ABIs, contract addresses, the gateway module, React hooks that wrap contract calls, and input validation logic. This is the only zone permitted to import `ethers.js`, `web3.js`, `viem`, or any blockchain interaction library. The hot zone is small, auditable, and changes infrequently.

**Cold Zone** (`ui/`): Pure presentational code. Components receive data via props and emit events via callbacks. They have no knowledge of blockchain, wallets, or transactions. A cold zone component can be tested with plain React Testing Library -- no mock providers, no fake wallets, no blockchain state. The cold zone is large, changes frequently, and is contributed to by designers and junior developers. Its compromise cannot result in fund theft.

**Warm Zone** (`app/`): The glue layer. Pages and providers that connect hot hooks to cold components. A page component imports a `useSwap()` hook from the hot zone and a `<SwapForm>` component from the cold zone, passing data down and callbacks up. The warm zone is the wiring diagram. It does not contain business logic or contract interaction logic.

### 4.2 The Gateway Pattern

The most critical element of the architecture is the **Gateway**: a single file (or small module) through which ALL contract interactions must flow.

```
┌─────────────────────────────────────────────────────┐
│                    HOT ZONE                          │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              GATEWAY (1 file)                   │  │
│  │                                                  │  │
│  │  - Imports ethers/viem                          │  │
│  │  - Holds provider + signer references           │  │
│  │  - Validates ALL inputs before submission       │  │
│  │  - Normalizes ALL outputs after receipt         │  │
│  │  - Logs every contract call                     │  │
│  │  - Enforces rate limits                         │  │
│  │  - Handles errors uniformly                     │  │
│  │                                                  │  │
│  │  swap(tokenIn, tokenOut, amount)                │  │
│  │  addLiquidity(tokenA, tokenB, amountA, amountB) │  │
│  │  commit(orderHash, deposit)                     │  │
│  │  reveal(orderId, secret)                        │  │
│  │  bridge(destChain, token, amount, recipient)    │  │
│  └────────────────────────────────────────────────┘  │
│                        │                              │
│              ┌─────────┴─────────┐                   │
│              │                    │                    │
│  ┌───────────▼──┐   ┌───────────▼──┐                │
│  │  useSwap()   │   │  useBridge() │   ...           │
│  │  (React hook)│   │  (React hook)│                 │
│  └──────────────┘   └──────────────┘                 │
│                                                      │
└─────────────────────────────────────────────────────┘
```

The Gateway is the **single door**. There is one way in and one way out. This has profound implications for auditability:

- **To verify that no unauthorized transactions can be constructed**, an auditor reviews one file.
- **To verify that all inputs are validated**, an auditor reviews one file.
- **To verify that all contract calls are logged**, an auditor reviews one file.
- **To verify that rate limiting is enforced**, an auditor reviews one file.

The hooks (`useSwap`, `useBridge`, etc.) are thin wrappers around Gateway functions. They manage React state (loading, error, success) and call Gateway methods. They do not import `ethers.js` directly. They do not construct transactions. They delegate.

### 4.3 Import Rules

The architecture is enforced through import constraints:

| Rule | Description | Enforcement Mechanism |
|------|-------------|----------------------|
| **I1** | Cold zone files MUST NOT import from `blockchain/` | ESLint `no-restricted-imports` |
| **I2** | Cold zone files MUST NOT import `ethers`, `web3`, `viem`, or any web3 library | ESLint `no-restricted-imports` |
| **I3** | Hot zone hooks MUST call Gateway, never construct transactions directly | Code review |
| **I4** | Warm zone pages import from both hot and cold, but contain no logic | Code review |
| **I5** | Cold zone components MUST be renderable without a wallet connection | Storybook / unit test |

Rule I1 is the load-bearing constraint. If it holds, the cold zone is provably unable to interact with contracts, regardless of what malicious code is injected into it. This can be enforced at the CI level with a single grep:

```bash
# CI check: cold zone must not import from hot zone
grep -r "from.*blockchain" src/ui/ && echo "VIOLATION: cold zone imports hot zone" && exit 1
```

### 4.4 Application to VibeSwap

VibeSwap's frontend contains 106 source files (51 components, 16 hooks, assorted utilities, contexts, and data files) serving an omnichain DEX with commit-reveal batch auctions, cross-chain bridging via LayerZero V2, Shapley-distributed rewards, and a game-mode interface inspired by the RuneScape Grand Exchange.

Under Hot/Cold Trust Boundary Architecture, the file distribution is:

```
HOT ZONE (blockchain/)                          ~15 files
├── contracts/
│   ├── CommitRevealAuction.json (ABI)
│   ├── VibeAMM.json (ABI)
│   ├── VibeSwapCore.json (ABI)
│   ├── DAOTreasury.json (ABI)
│   ├── CrossChainRouter.json (ABI)
│   ├── SoulboundIdentity.json (ABI)
│   ├── ShapleyDistributor.json (ABI)
│   ├── ILProtectionVault.json (ABI)
│   ├── SlippageGuaranteeFund.json (ABI)
│   └── WalletRecovery.json (ABI)
├── gateway/
│   └── index.js                  ← THE SINGLE DOOR
├── hooks/
│   ├── useWallet.jsx
│   ├── useDeviceWallet.jsx
│   ├── useSwap.jsx
│   ├── useBridge.jsx
│   ├── usePool.jsx
│   ├── useBatchState.jsx
│   ├── useContracts.jsx
│   ├── useCKBWallet.jsx
│   ├── useCKBContracts.jsx
│   ├── useVault.jsx
│   ├── useClawback.jsx
│   ├── useIncentives.jsx
│   ├── useBalances.jsx
│   └── useTransactions.jsx
└── validation/
    └── index.js

COLD ZONE (ui/)                                  ~70 files
├── components/                   (presentational)
├── layouts/
├── utils/                        (format, constants)
└── styles/

WARM ZONE (app/)                                  ~20 files
├── pages/                        (connect hot to cold)
├── providers/                    (context wrappers)
└── contexts/
```

The attack surface ratio:

```
Before separation:  R = 106 / 15 = 7.1
After separation:   R = 15 / 15  = 1.0
```

The audit surface shrinks by 86%.

---

## 5. Why It Works

### 5.1 Audit Efficiency

Smart contract audits are expensive. A top-tier audit firm charges $30,000-$150,000 per engagement. Frontend audits are rarer and less standardized, but the cost scales with scope. An auditor reviewing an undifferentiated 100-file frontend must trace data flow through every file to determine which ones can construct transactions.

With Hot/Cold separation, the auditor's scope is explicit: review `blockchain/`. Everything outside that directory is architecturally incapable of interacting with contracts. The audit is faster, cheaper, and more thorough because the scope is smaller and well-defined.

### 5.2 Bug Isolation

If a user reports that a swap transaction sent funds to the wrong address, the debugging surface is `blockchain/`. Not the 50 UI components. Not the utility functions. Not the layout components. The bug lives in the hot zone because that is the only place where transaction construction occurs.

This is not merely convenient. It is a formal guarantee. If the import rules hold (enforceable by linter), then contract-related bugs *cannot exist* outside the hot zone.

### 5.3 Testing Economics

Cold zone components are pure functions of their props. They can be tested with React Testing Library, Storybook, or visual regression tools without any blockchain infrastructure. No mock providers. No fake wallets. No local test chains. The test setup is:

```javascript
// Testing a cold zone component -- no blockchain needed
render(<SwapForm tokenIn="ETH" tokenOut="USDC" amount="1.5" onSubmit={mockFn} />)
expect(screen.getByText('ETH')).toBeInTheDocument()
fireEvent.click(screen.getByText('Swap'))
expect(mockFn).toHaveBeenCalledWith({ tokenIn: 'ETH', tokenOut: 'USDC', amount: '1.5' })
```

Hot zone hooks require blockchain mocks, but because the hot zone is small (15 files), the mocking infrastructure is manageable. The total test setup cost is:

```
Cold zone: 70 files x 0 mock complexity = trivial
Hot zone:  15 files x full mock complexity = manageable
Total:     manageable (vs. 106 files x partial mock complexity = painful)
```

### 5.4 Supply Chain Defense

This is the decisive advantage. Consider the attack scenario: a malicious npm package is introduced into the project through a transitive dependency of a charting library used by `PriceChart.jsx`.

**Without separation**: The malicious code executes in the same context as the swap logic. It can import `ethers.js`, access the wallet provider via `window.ethereum`, construct a `transfer()` call, and drain funds. The charting library was the entry point; the wallet was the target. Nothing in the architecture prevented the lateral movement.

**With separation**: `PriceChart.jsx` lives in the cold zone. The cold zone has no import path to `ethers.js` (enforced by linter). The malicious code executes, but it executes in a context where contract interaction is architecturally impossible. It can deface the UI, exfiltrate non-sensitive data, or redirect to a phishing page -- but it cannot construct transactions. The blast radius is contained.

```
┌─────────────────────────────────────────────────┐
│              ATTACK BLAST RADIUS                 │
│                                                   │
│  WITHOUT SEPARATION:                             │
│  ┌─────────────────────────────────────────────┐ │
│  │  Compromised dependency in ANY file         │ │
│  │  → Access to ethers.js                      │ │
│  │  → Construct malicious transactions         │ │
│  │  → DRAIN FUNDS                              │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  WITH SEPARATION:                                │
│  ┌─────────────────────┐ ┌───────────────────┐  │
│  │  Compromised dep    │ │  Hot Zone          │  │
│  │  in COLD zone       │ │  (not compromised) │  │
│  │  → No ethers.js     │ │  → Funds safe      │  │
│  │  → UI defacement    │ │                    │  │
│  │  → Phishing risk    │ │                    │  │
│  │  → NO FUND THEFT    │ │                    │  │
│  └─────────────────────┘ └───────────────────┘  │
│                                                   │
│  Compromised dep in HOT zone:                    │
│  → Still must pass through Gateway               │
│  → Gateway validates inputs                      │
│  → Gateway logs all calls                        │
│  → Detection is immediate                        │
└─────────────────────────────────────────────────┘
```

The separation does not eliminate the phishing risk from a compromised cold zone. An attacker who controls the UI can display a fake "approve" modal and redirect the user to a malicious site. But this is a fundamentally different threat class: it requires social engineering (tricking the user) rather than programmatic exploitation (constructing unauthorized transactions). Social engineering attacks are detectable by the user; programmatic attacks are not.

### 5.5 Onboarding and Organizational Security

In a team of 10 developers, perhaps 2-3 are blockchain-experienced. The others are frontend engineers, designers, or junior developers who build UI components, implement animations, and handle responsive layouts. In an undifferentiated architecture, every developer has implicit access to the contract interaction surface. A junior developer who accidentally imports the wrong module, or a designer who copies code from Stack Overflow, can introduce a vulnerability.

With Hot/Cold separation, the organizational boundary maps to the architectural boundary:

```
Senior blockchain devs  → Hot zone (requires review by security lead)
Frontend devs            → Cold zone (standard code review)
Designers                → Cold zone (CSS and layout only)
Junior devs              → Cold zone (safe by construction)
```

Pull requests that touch the hot zone trigger enhanced review. Pull requests that touch only the cold zone are low-risk by construction. The CI pipeline enforces this:

```yaml
# .github/workflows/security.yml
- name: Check trust boundary violations
  run: |
    # Fail if cold zone imports hot zone
    if grep -r "from.*blockchain" src/ui/; then
      echo "TRUST BOUNDARY VIOLATION"
      exit 1
    fi
    # Fail if cold zone imports web3 libraries
    if grep -r "from.*ethers\|from.*web3\|from.*viem" src/ui/; then
      echo "WEB3 IMPORT IN COLD ZONE"
      exit 1
    fi
```

---

## 6. The Knowledge Primitive

The Hot/Cold Trust Boundary Architecture is an instance of a general knowledge primitive:

> **The attack surface of a system is determined by how much code CAN interact with the critical resource, not how much code DOES. Minimize the CAN.**

This primitive is worth examining formally. Let:

- `C` = the set of all code units (files, modules, functions)
- `R` = a critical resource (funds, keys, database, secrets)
- `does(c, R)` = true if code unit `c` actually interacts with `R`
- `can(c, R)` = true if code unit `c` has the *capability* to interact with `R`

The **actual interaction surface** is `D = { c in C : does(c, R) }`.
The **potential interaction surface** is `A = { c in C : can(c, R) }`.
The **attack surface** is `A \ D` -- code that CAN but DOESN'T interact with `R`.

In security analysis, the attack surface is what matters. An attacker does not need code that already interacts with the resource. An attacker needs code that *can* be made to interact with the resource through injection, modification, or dependency manipulation.

The primitive asserts: **minimize `A` to approach `D`**. In the ideal case, `A = D`: the only code that can interact with the resource is code that was explicitly designed to do so.

This primitive applies to every system with a critical resource:

**Databases.** If every microservice has database credentials, the attack surface is every microservice. If only the data access service has credentials, the attack surface is one service. This is the principle behind database connection pooling through a dedicated service.

**API Keys.** If every file in a backend can read `process.env.STRIPE_SECRET_KEY`, the attack surface is the entire backend. If only the payment service reads the key, the attack surface is one service.

**Cryptographic Operations.** If every module can call signing functions, the attack surface is every module. If only a dedicated signing service has access to the private key, the attack surface is one service. This is literally how hardware security modules (HSMs) work.

**DeFi Frontends.** If every component can import `ethers.js`, the attack surface is every component. If only `blockchain/` can import `ethers.js`, the attack surface is one directory.

The pattern is universal because the underlying mathematics is universal. It is a direct consequence of the principle of least privilege applied at the architectural level rather than the access control level.

---

## 7. Comparison with Existing Approaches

### 7.1 How DeFi Frontends Typically Handle Trust Boundaries

Most do not. A survey of prominent DeFi frontend codebases reveals a common pattern: contract interaction code is co-located with UI code in the same directories, with no architectural boundary between them.

| Protocol | Architecture | Trust Boundary | Audit Surface |
|----------|-------------|----------------|---------------|
| Uniswap  | Monolithic `src/` | None | Entire app |
| Aave     | Feature-based folders | None | Entire app |
| Curve    | Mixed `components/` | None | Entire app |
| 1inch    | Layered but mixed | Informal | Most of app |
| VibeSwap | Hot/Cold/Warm zones | Formal | `blockchain/` only |

Some protocols employ informal conventions ("put contract calls in hooks") but do not enforce them architecturally. A convention without enforcement is a suggestion, not a security boundary.

### 7.2 Compromised Cold Zone vs. Compromised Hot Zone

The two scenarios produce categorically different outcomes:

**Scenario A: Compromised Cold Zone**

An attacker gains code execution in the cold zone (e.g., via a malicious npm package used by a UI component).

Available capabilities:
- Modify displayed values (show wrong balances, fake prices)
- Redirect users to external phishing sites
- Inject fake UI elements (fraudulent approval dialogs)
- Exfiltrate non-sensitive data (viewing history, preferences)
- Deface the application

Unavailable capabilities:
- Construct or submit blockchain transactions
- Access wallet provider or signer
- Modify transaction parameters in flight
- Approve token spending
- Transfer funds

**Maximum damage**: Social engineering (phishing). Requires the user to be tricked into signing a transaction on an external site. Detectable. Recoverable.

**Scenario B: Compromised Hot Zone**

An attacker gains code execution in the hot zone (e.g., via a compromised ABI file or gateway modification).

Available capabilities:
- All cold zone capabilities, plus:
- Construct arbitrary transactions
- Modify transaction parameters (recipient, amount)
- Submit unlimited token approvals
- Drain funds directly
- Interact with any contract on any chain

**Maximum damage**: Direct fund theft. Does not require user deception beyond the initial transaction signing (which appears legitimate). Difficult to detect. Potentially irrecoverable.

The difference is categorical, not quantitative. A compromised cold zone is an inconvenience. A compromised hot zone is a catastrophe. The architecture ensures that the catastrophe surface is as small as possible.

### 7.3 Defense in Depth

Hot/Cold separation is one layer in a defense-in-depth strategy. It complements, rather than replaces, other security measures:

```
┌───────────────────────────────────────────────────────┐
│  LAYER 5: User Education                              │
│  "Verify transaction details in your wallet"          │
├───────────────────────────────────────────────────────┤
│  LAYER 4: Wallet-Level Protection                     │
│  Hardware wallets, transaction simulation, allowlists │
├───────────────────────────────────────────────────────┤
│  LAYER 3: Smart Contract Guards                       │
│  Rate limits, circuit breakers, timelocks             │
├───────────────────────────────────────────────────────┤
│  LAYER 2: HOT/COLD TRUST BOUNDARIES        ← This   │
│  Architectural separation, import enforcement         │
├───────────────────────────────────────────────────────┤
│  LAYER 1: Infrastructure Security                     │
│  DNS security, CSP headers, SRI, npm audit            │
└───────────────────────────────────────────────────────┘
```

VibeSwap implements all five layers. The smart contract layer includes circuit breakers (volume, price, and withdrawal thresholds), rate limiting (1M tokens/hour/user), TWAP validation (max 5% deviation), flash loan protection (EOA-only commits), and 50% slashing for invalid reveals. The Hot/Cold boundary is Layer 2 -- it reduces the surface that Layers 3-5 must protect.

---

## 8. Implementation Considerations

### 8.1 Migration Path

For existing DeFi frontends, migration to Hot/Cold architecture can be performed incrementally:

1. **Inventory**: Identify all files that import web3 libraries. This is `A`, the current attack surface.
2. **Extract**: Move contract interaction logic into a new `blockchain/` directory. Start with the Gateway -- a single file that wraps all existing contract calls.
3. **Redirect**: Update existing hooks and components to call the Gateway instead of constructing transactions directly.
4. **Enforce**: Add ESLint rules and CI checks to prevent cold zone files from importing web3 libraries.
5. **Verify**: Confirm that the cold zone is clean. Run the grep check. Verify that `A = H`.

The migration can be performed file-by-file without disrupting development. Each step reduces the attack surface. The final enforcement step locks the boundary in place.

### 8.2 Framework-Specific Patterns

**React (VibeSwap's stack)**: The Gateway exports plain async functions. Hot zone hooks wrap Gateway calls in `useState`/`useEffect`. Cold zone components receive data via props and emit callbacks. Pages in the warm zone use hooks and render components.

**Vue**: The Gateway is a module. Hot zone composables (`useSwap`, `useBridge`) wrap Gateway calls. Cold zone components are pure SFCs with props/emits.

**Svelte**: The Gateway is a module. Hot zone stores wrap Gateway calls. Cold zone components are pure Svelte components with `export let` props.

The pattern is framework-agnostic. The Gateway is plain JavaScript/TypeScript. The zone boundaries are directory-level import restrictions. Any bundler and any linter can enforce them.

### 8.3 Limitations

Hot/Cold Trust Boundary Architecture does not defend against:

- **Compromised wallet software**: If MetaMask itself is compromised, no frontend architecture helps. The signing happens outside the application.
- **Compromised hot zone**: If the Gateway file itself is modified by a malicious actor, the architecture has failed at the innermost boundary. This is why the hot zone must be small and heavily reviewed.
- **Social engineering via cold zone**: A compromised cold zone can still display convincing phishing content. The architecture prevents programmatic fund theft, not user deception.
- **Build pipeline attacks that target the hot zone specifically**: A sophisticated attacker who understands the architecture could target a build plugin to inject code specifically into `blockchain/gateway/index.js`. This is a more difficult attack (requires knowledge of the architecture) but not impossible.

These limitations are not arguments against the architecture. They are arguments for defense in depth. The architecture reduces the attack surface; other layers address the residual risk.

---

## 9. Conclusion

The DeFi industry has spent five years and billions of dollars learning that smart contract security is necessary but insufficient. Frontend attacks are now the dominant exploit vector, and the reason is architectural: conventional frontend codebases provide undifferentiated privilege, allowing any file to interact with user funds.

Hot/Cold Trust Boundary Architecture applies the oldest principle in key management -- separation of concerns -- to frontend code organization. By isolating all contract interaction into a small, auditable hot zone and prohibiting the rest of the codebase from accessing web3 libraries, the architecture reduces the audit surface by 80-90%, contains the blast radius of supply chain attacks, and provides formal guarantees about which code can and cannot interact with funds.

The underlying knowledge primitive -- *minimize the code that CAN interact with the critical resource* -- generalizes beyond DeFi to any system with a critical resource. It is a restatement of the principle of least privilege at the architectural level, and it is enforced not by access control lists but by import boundaries and directory structure.

VibeSwap's 106-file frontend demonstrates that the pattern is practical at scale, compatible with modern React development, and enforceable through standard tooling (ESLint, CI checks). The migration path is incremental. The cost is minimal. The security improvement is categorical.

The vault door matters. But so does the lobby.

---

## References

1. Glynn, W. (2018). "Wallet Security Fundamentals." Unpublished research. Established seven axioms for cryptocurrency key management including cold storage supremacy, separation of concerns, and the centralized honeypot principle.

2. Bernstein, D.J. et al. (2012). "The Security Impact of a New Cryptographic Library." CHES 2012. Demonstrates that minimizing code that handles secrets reduces vulnerability surface.

3. Saltzer, J.H. and Schroeder, M.D. (1975). "The Protection of Information in Computer Systems." Proceedings of the IEEE, 63(9), 1278-1308. Establishes the principle of least privilege.

4. BadgerDAO Incident Report (2021). Post-mortem analysis of $120M frontend exploit via Cloudflare Workers script injection.

5. Ledger Connect Kit Incident Report (2023). Supply chain attack via compromised npm package enabling unauthorized transaction construction in DeFi frontends.

6. Curve Finance DNS Hijacking Incident (2022). DNS-level attack redirecting users to malicious frontend while smart contracts remained uncompromised.

7. VibeSwap Technical Documentation (2025-2026). Internal architecture documents, commit-reveal batch auction mechanism design, and frontend component specifications.

---

*This paper is part of the VibeSwap Research series. VibeSwap is an omnichain DEX built on LayerZero V2 that eliminates MEV through commit-reveal batch auctions with uniform clearing prices.*

*"The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge."*

# Your Keys, Your Coins
## Wallet Security Design That Doesn't Compromise

**Talk for Nervos Community**
**Speaker**: Will Glynn
**Draft**: v0.1

---

## The Problem (2 min)

Crypto has a UX problem disguised as a security problem.

**Option A: Custodial (Easy)**
- Sign up with email
- Someone else holds your keys
- *Mt. Gox. FTX. Celsius. Repeat.*

**Option B: Self-Custody (Hard)**
- 24 words on paper
- Lose it = lose everything
- *$140 billion in lost Bitcoin*

Users are forced to choose: **convenience or security**.

This is a false dilemma.

---

## The Thesis (30 sec)

**You can have both.**

Not "trust us" security.
Not "write down 24 words" UX.

Device-native security with self-custody guarantees.

---

## Seven Axioms of Wallet Security (3 min)

*From Will's 2018 paper on wallet security fundamentals.*

| # | Axiom | Implication |
|---|-------|-------------|
| 1 | **Your keys, your coins** | User MUST control private keys |
| 2 | **Cold storage is king** | Keys that never touch network can't be stolen remotely |
| 3 | **Web wallets are weakest** | Minimize server trust |
| 4 | **Honeypots attract hackers** | No centralized key storage |
| 5 | **Keys must be encrypted + backed up** | User-controlled recovery |
| 6 | **Separation of concerns** | Different wallets for different purposes |
| 7 | **Offline generation is safest** | Minimize network exposure during key creation |

**Every design decision must satisfy these axioms.**

---

## The VibeSwap Solution (5 min)

### Device Wallet: WebAuthn + Secure Element

```
┌─────────────────────────────────────────────────────┐
│                    YOUR DEVICE                       │
│  ┌─────────────────────────────────────────────┐   │
│  │           SECURE ELEMENT                     │   │
│  │  ┌─────────────────────────────────────┐    │   │
│  │  │  Private Key                         │    │   │
│  │  │  - Generated here                    │    │   │
│  │  │  - Signs here                        │    │   │
│  │  │  - NEVER LEAVES                      │    │   │
│  │  └─────────────────────────────────────┘    │   │
│  │  Protected by: Face ID / Touch ID / PIN     │   │
│  └─────────────────────────────────────────────┘   │
│                                                      │
│  [App] ──request──> [Secure Element] ──signature──> │
└─────────────────────────────────────────────────────┘
```

**Key insight**: Modern phones have hardware security modules. Use them.

### How It Works

1. **Key Generation** (Axioms 1, 7)
   - Private key generated IN the Secure Element
   - Never exported, never visible to app
   - Never touches network

2. **Transaction Signing** (Axioms 2, 3)
   - App sends unsigned transaction to Secure Element
   - User authenticates (biometrics)
   - Secure Element signs internally
   - Only signature leaves the device

3. **No Server Keys** (Axioms 3, 4)
   - VibeSwap servers never see private keys
   - No honeypot to hack
   - Compromise our servers = 0 keys stolen

---

## Recovery Without Compromise (3 min)

### The Recovery Trilemma

Pick two:
- **Security** (can't be stolen)
- **Recoverability** (can't be lost)
- **Self-custody** (no third party)

*Most wallets sacrifice one.*

### Our Approach: Encrypted Cloud Backup

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   DEVICE     │    │   CLOUD      │    │   RECOVERY   │
│              │    │              │    │              │
│  Private Key │───>│  Encrypted   │───>│  New Device  │
│  + User PIN  │    │  Blob        │    │  + User PIN  │
│              │    │  (useless    │    │              │
│              │    │  without PIN)│    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

**The Math**:
- Cloud backup = `AES-256(private_key, PBKDF2(user_PIN, salt))`
- Apple/Google sees encrypted blob
- Without PIN: computationally infeasible to crack
- User controls both factors: device + knowledge

**Axiom Compliance**:
- ✅ Self-custody (user has key)
- ✅ Recoverable (cloud backup)
- ✅ Secure (encrypted, PIN-protected)

---

## Separation of Concerns (2 min)

### Hot/Cold Architecture

```
┌─────────────────────────────────────────────┐
│  HOT WALLET (Device)                        │
│  - Daily transactions                       │
│  - Small amounts                            │
│  - Quick access                             │
│  - Acceptable risk                          │
└─────────────────────────────────────────────┘
                    │
                    │ Large transfers trigger warning
                    ▼
┌─────────────────────────────────────────────┐
│  COLD STORAGE (Hardware Wallet)             │
│  - Long-term holdings                       │
│  - Large amounts                            │
│  - Air-gapped                               │
│  - Maximum security                         │
└─────────────────────────────────────────────┘
```

**VibeSwap supports both**:
- Device wallet for daily DeFi
- Hardware wallet integration for serious holdings
- Intelligent prompts: "This is a large amount. Use hardware wallet?"

---

## What We Don't Do (1 min)

| Practice | Why We Avoid It |
|----------|-----------------|
| Server-side key storage | Honeypot. Axiom 4 violation. |
| Social recovery via email | Phishing vector. Server trust. |
| Seed phrase as default | Bad UX drives users to custodians |
| "Trust our security team" | Not verifiable. Not self-custody. |

**If we can steal your funds, the design is wrong.**

---

## Comparison (1 min)

| Feature | Custodial | Traditional Self-Custody | VibeSwap |
|---------|-----------|-------------------------|----------|
| Ease of setup | ✅ | ❌ | ✅ |
| Key control | ❌ (exchange) | ✅ (you) | ✅ (you) |
| Recovery | ✅ (email) | ❌ (seed phrase) | ✅ (PIN + cloud) |
| Hack = lose funds | ✅ (their breach) | ❌ | ❌ |
| Hardware security | ❌ | Optional | Built-in |

---

## The Axioms Applied (1 min)

| Axiom | VibeSwap Implementation |
|-------|------------------------|
| Your keys, your coins | Keys in YOUR Secure Element |
| Cold storage is king | Secure Element = cold-equivalent |
| Web wallets weakest | No web wallet. Device-native. |
| No honeypots | Zero server-side key storage |
| Encrypted backup | AES-256 + user PIN |
| Separation | Hot (device) / Cold (hardware) split |
| Offline generation | Keys generated in Secure Element |

**7/7 axioms satisfied.**

---

## Call to Action (1 min)

1. **Stop accepting the tradeoff** — demand both security AND UX
2. **Use device security** — your phone's Secure Element is underutilized
3. **Verify, don't trust** — if they hold your keys, they're not your coins

**The best security is security you'll actually use.**

---

## Q&A

Contact: [your contact]
GitHub: [repo link]
Security paper: `docs/wallet-security-fundamentals-2018.md`

---

## Appendix: Technical Details

### WebAuthn Flow
```javascript
// Registration (key generation)
navigator.credentials.create({
  publicKey: {
    challenge: serverChallenge,
    rp: { name: "VibeSwap" },
    user: { id, name, displayName },
    pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    authenticatorSelection: {
      authenticatorAttachment: "platform",  // Use device's Secure Element
      userVerification: "required"          // Require biometrics
    }
  }
})

// Signing (transaction authorization)
navigator.credentials.get({
  publicKey: {
    challenge: transactionHash,
    allowCredentials: [{ id: credentialId, type: "public-key" }],
    userVerification: "required"
  }
})
```

### Encryption Scheme
```
PIN → PBKDF2(PIN, salt, 100000 iterations) → 256-bit key
Private Key → AES-256-GCM(key, iv) → Encrypted Blob
Encrypted Blob → iCloud/Google Drive (user's account)
```

### Recovery Flow
1. User installs app on new device
2. App fetches encrypted blob from cloud
3. User enters PIN
4. PBKDF2 derives decryption key
5. AES decrypts private key
6. Key imported to new device's Secure Element
7. Old device's key remains valid (user can revoke)

---

*Your keys. Your coins. Your device. Your choice.*

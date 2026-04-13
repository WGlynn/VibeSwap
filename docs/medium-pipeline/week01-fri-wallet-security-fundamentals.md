# Wallet Security 101: Principles We Wrote in 2018 — Before DeFi Existed

## Your keys, your coins. Not your keys, not your coins. The rest is commentary.

---

*This paper was originally written in 2018. We're publishing it unedited. Some of the specific tools have changed — but every principle still holds. The fundamentals don't expire.*

---

When deciding to go down the financially anarchic path of cryptocurrency, you are relieving banks of the duty to protect your assets and assuming that responsibility onto yourself. This comes with the risk of being hacked. Private keys are the secret combinations that yield access to each wallet that your coins or tokens are stored in. If you are hacked and your private keys are stolen, the person who stole them has access to your coins or tokens and there is no way of recovering them. No fraud protection to call and no authority to reach. The rules of the Bitcoin network are intentionally simple. He who has the keys has the Bitcoin. The network doesn't care that you're Joe Shmoe and those bitcoins are rightfully yours — if someone else gets your keys, they get your funds.

> *"Your keys, your bitcoin. Not your keys, not your bitcoin."* — Andreas Antonopoulos

---

## Wallet Types Overview

There are four primary categories for wallet types:

1. **Desktop Wallet**
2. **Mobile Wallet**
3. **Hardware Wallet**
4. **Web Wallet**

### The Distinction That Matters: Wallets vs Clients

**A wallet** is a collection of data — your private keys, public keys, and address. A wallet can send and receive crypto in the form of spendable outputs.

**A client** is the software that connects you to the cryptocurrency network. It handles all the communication, updates the wallet with incoming funds, and uses information from the wallet to sign outgoing transactions.

The types of clients:

- **Full client** ("full node") — Has the entire history of blockchain transactions. Manages the user's wallets and can initiate transactions directly on the network.
- **Lightweight client** — Stores the user's wallet but relies on third-party servers to access the network.
- **Web client** — Accessed through a browser. Stores the user's wallet on a server owned by a third party.
- **Mobile client** — Usually on smartphones. Can operate as full, lightweight, or web client. Some sync across devices with a common source of funds.

---

## 1. Web Wallets

Web wallets are accessed through a browser and store your keys on someone else's server.

**The bottom line: Web wallets are the least secure. Especially exchange wallets.**

When you store crypto on an exchange, you trust a company not to steal your funds and disappear. You trust them to keep your funds safe from attacks. History has shown — repeatedly — that this trust is misplaced.

**Pros:**
- Easy access from any device
- Some are attached to exchanges with additional security features like offline storage

**Cons:**
- You don't control your keys
- You're trusting a company with everything
- Centralized target for attackers

---

## 2. Desktop Wallets

Software downloaded and installed on a PC or laptop. These range from lightweight multi-currency wallets to full nodes that download the entire blockchain.

### Full Node

**Advantages:**
- Better control and protection — private keys are encrypted with strong passphrases and regularly backed up
- It's more profitable for hackers to target centralized servers (many wallets in one place) than to target your individual machine

**Disadvantages:**
- Still vulnerable to internet-based attacks (spyware, malware, hardware failure)
- Long initial download and ongoing sync requirements
- Eats hard drive space

### Lightweight

**Advantages:**
- Same local key control without downloading the full chain
- Some can hold a wide range of assets

**Disadvantages:**
- Cannot independently verify transactions (no local history)
- Must trust third-party servers for transaction verification
- Still internet-connected, still attackable

---

## 3. Mobile Wallets

Installed on a mobile device. Usually operate as a lightweight or web client.

**Pros:**
- Portable
- Cameras scan QR codes natively
- Good for day-to-day transactions
- If the device is lost or stolen, backups can restore access

**Cons:**
- Phone dies, payments stop
- Screen visibility when entering PINs
- Choose reputable, proven wallets — not the first result in the app store

---

## 4. Cold and Colder Storage

This is our recommendation for anything you're not actively spending.

Keeping your private keys entirely offline is the best way to protect them.

**"True cold storage"** means the private keys have *never* been on a networked computer or device. Signing of outgoing transactions also occurs offline. This is best for long-term storage of large funds you won't be sending frequently.

**"Conventional cold storage"** is usually an offline medium that only goes online to sign transactions. More realistic for an active wallet, but still carries online risk during the signing window.

### Cold Storage Types

- **USB drive** or other offline data storage medium
- **Paper wallet** — public and private keys printed or written on paper
- **Physical bitcoin** — a bearer item with embedded keys
- **Hardware wallet** — dedicated signing device

### Hardware Wallets

- Not connected to anything by default — can't be hacked like a computer
- Private keys generated and stored within the device, never leave it
- Transactions signed within a PIN-protected external device requiring physical confirmation
- Less convenient than software wallets
- Buy from original manufacturers only — compromised shipments are a real attack vector

### Paper Wallets

Created by printing a new public address and private key onto paper.

**Pros:**
- Maximum protection from cyber-attacks, hardware failures, OS errors
- Free to generate

**Cons:**
- Loss, theft, or physical destruction
- Must be imported to software at some point (unlike hardware wallets)

**Critical: generate paper wallets offline.** Use a different wallet for spending and a separate one for long-term storage.

---

## The Fundamentals

1. Avoid online services for storage
2. If you must use a web wallet, save the page and generate keys offline
3. Back up your wallets regularly
4. Encrypt everything

---

## Why We're Publishing This Now

This was written in 2018 — before DeFi summer, before infinite approval exploits, before $160M in Q1 2026 losses across 18 protocols. Before SquidRouter approvals got drained across multiple chains because someone approved the wrong contract.

Every one of those incidents traces back to the same root: someone didn't control their keys, or they trusted a system they shouldn't have, or they approved something they didn't understand.

The tools have evolved. The wallets are better. The attack surface is larger. But the principles haven't changed:

**Control your keys. Verify before you sign. Store cold what you're not spending. Trust no one with custody you wouldn't trust with your life.**

The rest is implementation detail.

---

*This is Part 3 of the VibeSwap Security Architecture series.*
*Previously: [The Siren Protocol](link-to-wednesday-post) — adversarial judo in decentralized consensus.*
*Next week: The Omniscient Adversary Proof — what if the attacker knows everything?*

*Originally written 2018. Published unedited, with a postscript, because fundamentals don't expire.*

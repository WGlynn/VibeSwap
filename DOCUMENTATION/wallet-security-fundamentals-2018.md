# Wallet Security 101

**Author**: Will Glynn (2018)

*So you wanna own crypto? Read this first*

---

When deciding to go down the financially anarchic path of cryptocurrency, you are relieving banks of the duty to protect your assets and assuming that responsibility onto yourself. This comes with the risk of being hacked. Private keys are the secret combinations that yield access to each wallet that your coins or tokens are stored in. If you are hacked and your private keys are stolen, the person who stole them has access to your coins or tokens and there is no way of recovering them. No fraud protection to call and no authority to reach. The rules of the Bitcoin network are intentionally simple. He who has the keys has the Bitcoin. The network doesn't care that you're Joe Shmoe and those bitcoins are rightfully yours, if someone else gets your keys, they get your funds.

> "Your keys, your bitcoin. Not your keys, not your bitcoin." - Andreas Antonopoulos

---

## Wallet Types Overview

There are 4 primary categories for wallet types:
1. Desktop Wallet
2. Mobile Wallet
3. Hardware Wallet
4. Web Wallet

### Important Distinction: Wallets vs Clients

**A wallet** is a collection of data such as a user's private and public keys and his address. A wallet can send and receive crypto in the form of spendable outputs.

**A client** is the software that connects a user to the cryptocurrency network in question. It handles all the communication, updates the wallet with incoming funds, and uses information from the wallet to sign outgoing transactions.

- **Full client** ("full node"): Has the entire history of blockchain transactions. Also manages the user's wallets and can initiate transactions directly on the network.
- **Lightweight client**: Stores the user's wallet but relies on third-party servers to access the network.
- **Web client**: Accessed through a web browser and stores the user's wallet on a server owned by a third party.
- **Mobile client**: Usually used on smartphones, can operate as a full client, lightweight client, or web client. Some mobile clients are synchronized with a web or desktop client, providing a multi-platform wallet across multiple devices, with a common source of funds.

---

## 1. WEB WALLET

Web wallets vary from coin to coin. Using Bitcoin as an example:

1. Go to a web wallet provider like https://blockchain.info/
2. Click on option "Get a Free Wallet"
3. Sign up providing your username and choose a secure password
4. BTC, Ether, and BCH can be exchanged and stored in this wallet
5. Explore the advanced security options such as recovery phrase, Google authenticator, etc.

To receive bitcoins or other cryptocurrencies, you must notify the sender about your wallet's address, just as how you would exchange email addresses to send email.

**Cautionary note on exchanges**: Avoid storing your cryptocurrencies with an exchange, even for a limited amount of time, it exposes you to many dangers.

> **Web wallets are the least secure. Especially exchange web wallets.**

### Examples
Green Address, Circle, Coinbase, Coinkite

*Web wallets store your private keys (i.e. password) for you on their servers*

### Pros
- Easy access to funds from any device
- Some wallets are attached to exchanges and offer additional security such as offline storage (Coinbase does both)

### Cons
- You trust a company not to steal your funds and disappear
- You trust a company to keep your funds safe from attacks

---

## 2. DESKTOP WALLETS

Software downloaded and installed on a PC or laptop.

Most wallet software is made by volunteers or cryptocurrency startups and are tailored to their specific coin. Some lightweight wallets like Coinomi and Exodus are multicurrency and can store a wide variety of coins in the same location.

Desktop wallets can be full nodes. In this case they consistently update the transaction history of the blockchain to contribute to the maintenance of the decentralized network and its consensus.

### Full Node Desktop Wallet

**Advantages:**
- Better control and protection. *Private keys are encrypted with strong passphrases and regularly backed up*
- It is more incentivizing for hackers to target centralized third party servers to steal many wallets than to target an individual's computer

**Disadvantages:**
- Still a bit vulnerable to Internet attacks (spying, malware or hardware malfunctions)
- It takes a long time to download and can be inconvenient to keep synchronizing with the network
- Reduces your hard drive capacity

### Lightweight Desktop Wallet

**Advantages:**
- Same advantages of a desktop wallet, yet you don't have to download a full node
- Private key is held on your computer, meaning you have total control
- Some can hold a wide range of assets

**Disadvantages:**
- Cannot verify transactions as it does not have the transaction history on it
- Therefore must trust the third-party servers to verify transactions for you
- Still a bit vulnerable to Internet attacks

---

## 3. MOBILE WALLETS

Installed on a mobile device - usually operate as a lightweight client or a web client.

### Pros
- Portable
- Smartphone cameras can scan QR codes
- Good for day-to-day transactions
- If mobile device is lost or stolen the funds are not gone, backups can help you access your funds (in case of theft, contact third party immediately)

### Cons
- Due to low battery, if the phone dies or is turned off payments are affected
- Do not type your PIN when the device is visible to others
- Choose reputable and proven secure wallets

---

## 4. COLD AND COLDER STORAGE (Best Recommendation)

a.k.a. Paper or Hardware Wallets

Keeping your private keys entirely offline is the best way to protect them.

**"True cold storage"** means that the private keys have never been on a networked computer or device. Signing of outgoing transactions also occurs offline. This procedure is best for long-term storage of large funds that you will not be sending out very frequently. Offline storage is impractical for everyday use.

**"Conventional cold storage"** is usually an offline medium for storing cryptocurrencies that only goes online to sign transactions. This is more realistic for an active wallet, but still comes with online threats.

### Cold Storage Types
- USB drive or other data storage medium
- Paper wallet
- A physical bitcoin known as a bearer item
- An offline hardware wallet

### Hardware Wallets

- Provide extra security, not connected to anywhere, cannot be hacked like a computer
- Private keys generated, stored within the device and never leave the device
- Transactions signed within a PIN protected external device (requires physical confirmation)
- Less convenience than desktop and mobile wallets
- Price / buy from original stores to avoid compromised shipments

**Examples**: Trezor, Ledger Nano S

### Paper Wallet

Created by printing a new public address and private key onto paper, or writing it down. Store documents with public and private keys in a safe place, make at least 2 copies.

**Pros:**
- Maximum protection from cyber-attacks/hardware failures/operating system errors/breakdowns
- Easily generated free

**Cons:**
- Loss, theft, paper destruction
- Must be imported to software at some time, unlike hardware wallets

**IMPORTANT**: Make sure you are working offline when generating a paper wallet!

Generate a different wallet for expenses that you pay using bitcoins, and use different ones for long term storage.

---

## Recap for All Wallets

1. Avoid use of online services
2. If you use an online web wallet, it is advised to save that page and generate the private keys offline
3. Back up your wallets regularly
4. Encrypt your wallet

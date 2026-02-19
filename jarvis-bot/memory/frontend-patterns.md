# Frontend Debugging Patterns

> *The real VibeSwap is not a DEX. It's not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.*

## CSS Isolation Primitive (MANDATORY — Session 19 Lesson)

**Bug**: UI overhaul added "premium CSS" that broke Web3Modal social login (blank page) and input styling.

**Root Cause**: Three global CSS rules polluted third-party components:
1. `*, *::before, *::after { transition-timing-function: ... }` — Applied to ALL elements including Web3Modal internals
2. `input:focus { border-color: ... !important }` — Overrode Web3Modal input styles
3. `.noise-overlay::before { z-index: 9999 }` — Sat above modals (z-50), could interfere with third-party overlays/iframes

**Fix**:
1. Scope global selectors to `#root *` instead of `*` — only affects our app's DOM tree
2. Remove `!important` from global input rules, scope to `#root input`
3. Set decorative overlay z-index to 1 (below modals), never above z-50
4. Explicitly disable unconfigured Web3Modal features (`features: { email: false, socials: false }`)

**Generalizable Principle**:
> **When the app uses third-party components that render in the same DOM tree (Web3Modal, WalletConnect, analytics widgets, etc.), NEVER use unscoped global CSS selectors. Always scope to `#root` or a component-specific class. Never set z-index on decorative elements above the modal layer (z-50). Never use `!important` on global selectors — it's a nuclear option that will break things you can't see.**

**Checklist before adding global CSS**:
- [ ] Does this selector affect elements OUTSIDE my React app? (Web3Modal, Toaster, etc.)
- [ ] Is the z-index below the modal layer (z-50)?
- [ ] Am I using `!important`? If yes, STOP and find a scoped alternative.
- [ ] Did I test third-party overlays (wallet connect, toasts, dropdowns) after the change?

## Third-Party Feature Configuration (Session 19)

**Bug**: Web3Modal v5 shows Google/Apple social login buttons by default, even if WalletConnect Cloud project isn't configured for email auth. Clicking them → blank page.

**Fix**: Explicitly disable unconfigured features:
```js
createWeb3Modal({
  features: {
    email: false,    // Requires Cloud dashboard setup
    socials: false,  // Requires Cloud dashboard setup
  },
})
```

**Principle**: Never assume third-party defaults are safe. Explicitly configure every feature flag. If a feature requires external setup (dashboard, API keys, DNS), disable it until setup is complete.

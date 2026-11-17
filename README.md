# agy-switcher

macOS account switcher and quota tracker for **Antigravity CLI (`agy`)** and **Paseo Desktop**.

`agy-switcher` stores multiple Google OAuth sessions safely inside the **macOS Keychain** (`service="gemini"`, `account="antigravity-profile:<alias>"`), switches the active slot (`gemini:antigravity`) atomically with `~/.gemini/jetski-standalone-oauth-token`, and queries Google Cloud Code Assist internal endpoints for **Tier**, **Gemini 5h**, **Claude/GPT 5h**, and **Claude/GPT Weekly** quotas + reset times.

---

## Architecture

- **`src/core/`** — Shared core library:
  - `keychain.ts`: `/usr/bin/security` wrapper + `go-keyring-base64:<base64(JSON)>` codec
  - `fallback.ts`: Atomic `0600` sync for `~/.gemini/jetski-standalone-oauth-token`
  - `token.ts`: In-memory OAuth2 token refresh
  - `client.ts`: Cloud Code Assist client (`loadCodeAssist`, `retrieveUserQuotaSummary`, `retrieveUserQuota`)
  - `quota.ts` & `scorer.ts`: Normalizes Gemini, 5h, and Weekly buckets + scores best profile
  - `profile.ts`: `ProfileService` (`saveProfile`, `listProfiles`, `useProfile`, `deleteProfile`, `useBestProfile`)
- **`src/cli/` & `bin/agy-switcher.mjs`** — Terminal CLI (`agy-switcher` / `agys`)
- **`plugin/`** — Paseo Desktop plugin (`paseo-plugin.json`, `index.server.ts`, `index.client.tsx`) built with `@getpaseo/plugin` and Hermes-compatible React Native primitives.

---

## First-Time Setup (2+ Accounts)

Requires **Node.js >= 20** (tested on Node 24) on macOS.

```bash
npm install
npm link   # exposes `agy-switcher` and `agys` globally
```

Save your existing accounts once:

```bash
# 1. With Account 1 already logged into `agy`:
agy-switcher save pro1

# 2. Inside `agy`, run /logout, then log in as Account 2 via browser:
agy-switcher save pro2
```

From then on, switch anytime without `/logout` or re-authenticating in the browser.

### Zero Credentials Stored in Repo

- Saved user accounts (`refresh_token`, `access_token`, emails) live exclusively in **macOS Keychain** (`gemini:antigravity-profile:<alias>`) and `~/.gemini/jetski-standalone-oauth-token` (`0600`).
- OAuth app credentials needed for in-memory token refresh are **never hardcoded** in the repository: on any machine with `agy` installed, `agy-switcher` auto-discovers them from the local `agy` binary and caches the verified pair outside the repo at `~/.config/agy-switcher/oauth.json` (`0600`). You can also override via `AGY_OAUTH_CLIENT_ID` / `AGY_OAUTH_CLIENT_SECRET` or `AGY_BIN`.

---

## CLI Usage

```bash
agy-switcher                 # Interactive TTY picker (↑/↓, Enter, b = best, q = quit)
agy-switcher ls              # List profiles with Tier, Gemini, 5h & Weekly quotas + reset time
agy-switcher ls --json       # Machine-readable JSON output
agy-switcher ls --no-quota   # List Keychain profiles without network requests
agy-switcher use pro2        # Switch active Keychain slot & sync fallback file
agy-switcher best            # Switch to the profile with the highest remaining quota
agy-switcher best --dry-run  # Preview the best profile without switching
agy-switcher status          # Show currently active session and live quota
agy-switcher save pro1 -f    # Overwrite an existing alias
agy-switcher rm pro1         # Remove a saved profile from Keychain
```

> **Note:** Switching updates `gemini:antigravity` in macOS Keychain for new `agy` sessions and newly spawned Paseo agents. Already-running agent processes retain their in-memory tokens until restarted.

---

## Paseo Desktop Plugin

The self-contained Paseo plugin lives under `plugin/`:

- **Settings Screen & Global Screen (`Antigravity Accounts`)**: view all saved profiles with Gemini 5h, Claude/GPT 5h, and Claude/GPT Weekly progress bars + local reset timestamps, save the current active session, remove profiles, or switch with 1 click.
- **Workspace Panel (`Antigravity`)**: quick access inside workspace/explorer panes.
- **Command Center**:
  - `Antigravity: Open Account Switcher`
  - `Antigravity: Switch to Best Quota Account`

Install into Paseo Desktop from a clean git commit/tag (never hot-patch directly into `~/.paseo/plugins/`).

---

## Development & Verification

```bash
npm run sync:plugin-core   # Sync src/core/ -> plugin/server/core/
npm run check              # Sync check + tsc --noEmit + Hermes/CJS bundle check + all tests
node test/run-e2e.mjs      # Run the 4-tier hermetic E2E matrix
```

# agy-switcher

Fast, Keychain-backed account switcher and multi-window quota monitor for **Google Antigravity CLI (`agy`)** and **Paseo Desktop** on macOS.

Switch between multiple Google accounts in one command (or one click in Paseo) without `/logout` + browser re-authentication, while tracking **Tier**, **Gemini (5h)**, **Claude / GPT (5h)**, and **Claude / GPT (Weekly)** limits with live reset timestamps.

---

## Why `agy-switcher`?

`agy` stores only one active session in macOS Keychain (`service="gemini"`, `account="antigravity"`). Juggling multiple Google accounts normally forces you to `/logout` and re-authenticate through the browser every time.

`agy-switcher` solves this cleanly:

- **Zero plaintext refresh tokens on disk:** Saved profiles are stored inside **macOS Keychain** (`service="gemini"`, `account="antigravity-profile:<alias>"`), never inside this repository or plaintext profile files.
- **Full 5h + Weekly visibility:** Queries Google Cloud Code Assist's internal quota endpoints (`loadCodeAssist`, `retrieveUserQuotaSummary`, `retrieveUserQuota`) in parallel—showing both the 5-hour rolling window and the 7-day weekly limit with local reset times.
- **One shared core, two interfaces:**
  - **CLI (`agy-switcher` / `agys`)** with interactive TTY picker and `best` auto-selection.
  - **Paseo Desktop Plugin (`plugin/`)** with Settings, Global Screen, Workspace Panel, and Command Center integration.
- **Zero hardcoded OAuth secrets in repo:** Auto-discovers installed-app OAuth client credentials from your local `agy` binary on first token refresh and caches them externally at `~/.config/agy-switcher/oauth.json` (`0600`).

---

## Requirements

- **macOS** (uses `/usr/bin/security` for Keychain operations)
- **Node.js >= 22.18** (native TypeScript execution; tested on Node 24)
- **Antigravity CLI (`agy`)** installed locally
- *(Optional)* **Paseo Desktop >= 0.13.0** for the Paseo plugin

---

## Installation

```bash
git clone https://github.com/daymanondev/agy-switcher.git
cd agy-switcher
npm install
npm link
```

This exposes both `agy-switcher` and the short alias `agys` on your `PATH`.

---

## Quick Start

Save each Google account **once**:

```bash
# 1. With your first Google account already signed into `agy`:
agy-switcher save pro1

# 2. Inside `agy`, run /logout, sign into your second account via browser, then:
agy-switcher save pro2
```

After onboarding, you never need `/logout` to switch between saved accounts:

```bash
agy-switcher ls       # Inspect all accounts, tiers, 5h & weekly quotas, and reset times
agy-switcher use pro2 # Switch active Keychain session & sync fallback file
agy-switcher best     # Automatically switch to the account with the highest available quota
agy-switcher          # Launch interactive TTY picker
```

---

## CLI Reference

| Command | Description |
| --- | --- |
| `agy-switcher` *(TTY)* | Open interactive picker (`↑/↓` or `j/k` move, `Enter` switch, `b` switch best, `q` quit) |
| `agy-switcher save <alias> [--force\|-f]` | Snapshot the active Keychain session under `<alias>` |
| `agy-switcher ls [--json] [--no-quota]` | List saved profiles with tier, Gemini, Claude/GPT 5h & Weekly quotas + reset times |
| `agy-switcher use <alias>` | Switch active Keychain slot (`gemini:antigravity`) and sync `~/.gemini/jetski-standalone-oauth-token` (`0600`) |
| `agy-switcher best [--dry-run]` | Score all profiles and switch to the one with the highest usable quota |
| `agy-switcher status [--json] [--no-quota]` | Show the currently active email, matched alias, and live quota breakdown |
| `agy-switcher rm <alias>` | Delete a saved profile from Keychain |
| `agy-switcher -h \| --help` | Show CLI help |
| `agy-switcher -v \| --version` | Show CLI version |

### Example `ls` Output

```text
ALIAS        EMAIL                    TIER            GEMINI               5H QUOTA             WEEKLY                    STATUS
----------------------------------------------------------------------------------------------------------------------------------
pro1         nick1@gmail.com          g1-pro-tier     [████░] 88% (3h 20m) [█████] 100% (ready) [███░░] 69% (6d 1h · 22/11 15:26) * active
pro2         nick2@gmail.com          g1-pro-tier     [█████] 100% (ready) [█████] 100% (ready) [█████] 100% (ready)          ready
```

### Best-Account Scoring

`best` ranks profiles using a composite score `[0..105]`:

- **Weights:** `50%` Claude/GPT 5h remaining + `30%` Claude/GPT Weekly remaining + `20%` Gemini remaining + `+5` paid-tier bonus.
- **Hard bottleneck gate:** Any profile with `< 5%` remaining in its 5-hour window is multiplied by `0.10x` to force failover away from nearly exhausted accounts.
- **Tie-breaking:** Profiles within `2.0` points break ties by earliest bottleneck reset time, then currently active profile.

---

## Paseo Desktop Plugin

The `plugin/` directory is a self-contained Paseo plugin (`>= 0.13.0`) built with `@getpaseo/plugin` and Hermes-compatible React Native primitives:

- **Settings Screen & Global Screen (`Antigravity Accounts`):** View all profiles with progress bars for Gemini (5h), Claude/GPT (5h), and Claude/GPT (Weekly) + local reset timestamps, save the current active session, remove profiles, or switch with 1 click.
- **Workspace Panel (`Antigravity`):** Quick switcher available in `workspace` and `explorer` locations.
- **Command Center Actions:**
  - `Antigravity: Open Account Switcher`
  - `Antigravity: Switch to Best Quota Account`

### Installing in Paseo

Install directly via Paseo's plugin manager using the Git repository URL:

```text
https://github.com/daymanondev/agy-switcher.git
```

Do not manually copy or hot-patch files into `~/.paseo/plugins/` while Paseo is running.

> **Session behavior:** Terminal `agy` and Paseo Desktop (`provider: "antigravity"`) share the same Keychain slot `gemini:antigravity`. Switching applies immediately to new `agy` sessions and newly spawned Paseo agents; already-running agent processes retain their in-memory tokens until restarted.

---

## How It Works & Security Model

1. **Keychain Storage:** Uses macOS `/usr/bin/security` with `go-keyring-base64:<base64(JSON)>` payloads:
   - Active slot: `service="gemini"`, `account="antigravity"`
   - Saved slots: `service="gemini"`, `account="antigravity-profile:<alias>"`
2. **Fallback Sync:** Switching atomically writes `~/.gemini/jetski-standalone-oauth-token` via temp-file + `chmod 0600` + `rename` so `agy` fallback reads stay aligned.
3. **In-Memory Token Refresh:** When checking quotas for inactive profiles, expired `access_token`s are refreshed in memory without overwriting the active Keychain slot or modifying saved profile entries.
4. **OAuth Client Discovery:** No OAuth `client_secret` or personal credentials are stored in this repository. Credentials are resolved in order:
   1. `AGY_OAUTH_CLIENT_ID` & `AGY_OAUTH_CLIENT_SECRET` env vars
   2. `~/.config/agy-switcher/oauth.json` (`0600`, outside the repo)
   3. Auto-extraction from the locally installed `agy` binary (`AGY_BIN` or `PATH` / `~/.local/bin/agy`)

### Environment Variables

| Variable | Purpose |
| --- | --- |
| `AGY_BIN` | Override path to the `agy` binary for OAuth client discovery |
| `AGY_OAUTH_CLIENT_ID` | Override Google OAuth client ID |
| `AGY_OAUTH_CLIENT_SECRET` | Override Google OAuth client secret |
| `AGY_SECURITY_BIN` | Override `/usr/bin/security` path (useful in tests) |
| `AGY_API_BASE_URL` | Override Cloud Code Assist base URL (default `https://daily-cloudcode-pa.googleapis.com`) |
| `AGY_TOKEN_URL` | Override Google OAuth2 token endpoint (default `https://oauth2.googleapis.com/token`) |

---

## Project Structure & Development

```text
agy-switcher/
├── bin/agy-switcher.mjs      # CLI executable entrypoint
├── src/
│   ├── core/                 # Keychain, fallback sync, OAuth refresh, Cloud Code client, quota normalizer, scorer
│   └── cli/                  # CLI parser, commands, quota table formatter, TTY picker
├── plugin/                   # Self-contained Paseo Desktop plugin
│   ├── paseo-plugin.json
│   ├── index.server.ts
│   ├── index.client.tsx
│   ├── shared/rpc.ts
│   ├── server/               # RPC handlers + synced core (`plugin/server/core/`)
│   └── client/               # Hermes-compatible React Native UI
├── scripts/
│   ├── sync-plugin-core.mjs  # Syncs src/core/ -> plugin/server/core/
│   └── check-bundle.mjs      # Verifies esbuild Hermes client + CJS server VM evaluation
└── test/                     # Unit tests (core, cli, plugin) + 4-tier hermetic E2E suite
```

### Verification Commands

```bash
npm run sync:plugin-core        # Sync src/core/ into plugin/server/core/
npm run sync:plugin-core:check  # Verify zero drift between src/core/ and plugin/server/core/
npm run typecheck               # Run tsc --noEmit
npm run check:bundle            # Build & validate Hermes client + CJS server bundles from git-tracked files
npm test                        # Run all unit, plugin, and 4-tier E2E tests (mocked Keychain & API)
npm run check                   # Run all of the above
node test/run-e2e.mjs           # Print the 4-tier E2E summary matrix
```

---

## Disclaimer

`agy-switcher` interacts with macOS Keychain and Google Cloud Code Assist internal endpoints used by the Antigravity CLI. Internal API payloads may change across Antigravity releases. This project is not affiliated with or endorsed by Google.

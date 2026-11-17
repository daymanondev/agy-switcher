# E2E Test Infra: agy-switcher

## Test Philosophy
- **Opaque-box, requirement-driven**: Tests validate user-visible behaviors, CLI commands, Keychain formats, and Paseo plugin contracts defined in `ORIGINAL_REQUEST.md` and `PROJECT.md`.
- **Hermetic & Isolated**: Tests run in an isolated sandbox with mocked `/usr/bin/security`, isolated temporary directories for `~/.gemini/jetski-standalone-oauth-token`, and a mock HTTP server for Cloud Code Assist API calls. Zero writes to live user keychains or live network endpoints.
- **Node 24 Native ESM**: Built on `node:test` and `node:assert`, standard ESM syntax, fast asynchronous execution.

## Feature Inventory & Matrix
| # | Feature | Requirement Source | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Cross-Feature) | Tier 4 (Workflows) |
|---|---------|-------------------|:-----------------:|:-------------------:|:----------------------:|:------------------:|
| 1 | Keychain CRUD & Payload Format | ORIGINAL_REQUEST R1, §13, §15 | 5 | 5 | ✓ | ✓ |
| 2 | Fallback Token File Sync | ORIGINAL_REQUEST R1, §14 | 5 | 5 | ✓ | ✓ |
| 3 | In-Memory Token Refresh | ORIGINAL_REQUEST R1, §27 | 5 | 5 | ✓ | ✓ |
| 4 | Cloud Code Assist API Client | ORIGINAL_REQUEST R1, §17-§20, §28 | 5 | 5 | ✓ | ✓ |
| 5 | Quota Scoring & Best Selection | ORIGINAL_REQUEST R1, §35 | 5 | 5 | ✓ | ✓ |
| 6 | CLI Commands & Visualizer | ORIGINAL_REQUEST R2, §31-§37 | 5 | 5 | ✓ | ✓ |
| 7 | Paseo Plugin RPC Contracts | ORIGINAL_REQUEST R3, §39-§43 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Runner**: Node 24 test runner via `node --test test/e2e/**/*.test.ts` or `node test/run-e2e.mjs`.
- **Harness & Sandboxing**:
  - `test/e2e/harness/mock-keychain.ts`: Intercepts or simulates `/usr/bin/security find-generic-password`, `add-generic-password`, `delete-generic-password` with standard exit codes (0 for success, 44 for item not found).
  - `test/e2e/harness/mock-cloudcode-server.ts`: Lightweight Node `http` server simulating Google Cloud Code Assist endpoints: `loadCodeAssist`, `retrieveUserQuotaSummary`, and `retrieveUserQuota` with configurable latencies, errors (401, 429, 500), and quota bucket structures.
  - `test/e2e/harness/mock-fs.ts`: Creates a sandboxed `HOME` directory with `.gemini/jetski-standalone-oauth-token` to test file permissions (0600) and atomic writes.
  - `test/e2e/harness/cli-runner.ts`: Invokes CLI subcommands (`save`, `ls`, `use`, `best`, `rm`) with isolated environment variables (`HOME`, mock keychain interceptor, API base URL).

## Directory Layout
```
test/
├── run-e2e.mjs
└── e2e/
    ├── harness/
    │   ├── mock-keychain.ts
    │   ├── mock-cloudcode-server.ts
    │   ├── mock-fs.ts
    │   └── test-context.ts
    ├── tier1-features/
    │   ├── keychain-features.test.ts
    │   ├── fallback-sync.test.ts
    │   ├── token-refresh.test.ts
    │   ├── quota-api.test.ts
    │   ├── best-scorer.test.ts
    │   ├── cli-commands.test.ts
    │   └── plugin-rpc.test.ts
    ├── tier2-boundaries/
    │   ├── empty-states.test.ts
    │   ├── corrupt-payloads.test.ts
    │   ├── api-errors.test.ts
    │   ├── missing-project.test.ts
    │   └── cli-edge-cases.test.ts
    ├── tier3-combinations/
    │   ├── save-switch-active.test.ts
    │   ├── switch-fallback-sync.test.ts
    │   ├── switch-quota-flow.test.ts
    │   ├── best-profile-dynamic.test.ts
    │   └── cli-plugin-consistency.test.ts
    └── tier4-scenarios/
        ├── scenario-onboarding.test.ts
        ├── scenario-quota-exhaustion-failover.test.ts
        ├── scenario-transparent-token-refresh.test.ts
        ├── scenario-paseo-command-center.test.ts
        └── scenario-corrupt-recovery.test.ts
```

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Multi-account onboarding & inventory | F1 (Keychain), F2 (Fallback), F6 (CLI save/ls) | Medium |
| 2 | Depleted quota automatic failover | F4 (Quota API), F5 (Scorer), F6 (CLI best), F1 (Keychain switch), F2 (Fallback sync) | High |
| 3 | Transparent expired token renewal on CLI usage | F3 (Token refresh), F4 (Quota API), F6 (CLI ls) | Medium |
| 4 | Paseo Desktop Command Center 1-click switch best | F7 (Paseo RPC), F5 (Scorer), F1 (Keychain), F2 (Fallback) | High |
| 5 | Corrupted fallback file self-healing recovery | F1 (Keychain), F2 (Fallback sync 0600), F6 (CLI use) | Medium |

## Coverage Thresholds
- **Tier 1**: ≥5 isolated test cases per feature (7 features × 5 = 35 test cases).
- **Tier 2**: ≥5 edge/boundary/error test cases per feature area (≥25 test cases).
- **Tier 3**: Cross-feature pairwise interactions (≥5 comprehensive integration test suites).
- **Tier 4**: Realistic multi-step end-user scenarios (≥5 end-to-end workflows).
- **Total Minimum Test Count**: ≥70 tests across Tiers 1-4.

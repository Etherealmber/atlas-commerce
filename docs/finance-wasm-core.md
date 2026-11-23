# Atlas Commerce — Rust + WebAssembly Finance Core & Production Pipeline

## 1. Architecture & Artifact Strategy

`rust/atlas-finance-core/` is a **zero-dependency** Rust financial, calendar, and validation kernel compiled to `wasm32-unknown-unknown` and mirrored deterministically by `shared/financeCore.ts`.

### WASM Artifact Strategy (Build-Generated, Not Committed to Git)
- Compiled binaries (`worker/wasm/*.wasm`, `worker/wasm/.finance-wasm-build.json`, and `rust/atlas-finance-core/target/`) are **excluded from Git** (`.gitignore`) so repository history stays clean and deterministic.
- `rust-toolchain.toml` pins **`1.82.0`** (`rustfmt`, `clippy`, target `wasm32-unknown-unknown`, profile `minimal`).
- `scripts/ensure-rust-wasm-toolchain.mjs` verifies the pinned toolchain and automatically bootstraps `rustup` (`1.82.0` + `wasm32-unknown-unknown`) in automated build environments (`CF_PAGES`, `WORKERS_CI`, `CLOUDFLARE_WORKERS_BUILD`, `CI`, or `--install`).
- `scripts/build-finance-wasm.mjs --strict` computes a SHA-256 content fingerprint over `rust-toolchain.toml`, `Cargo.toml`, `Cargo.lock`, `rust/atlas-finance-core/src/**/*.rs`, `scripts/build-finance-wasm.mjs`, and `rustc --version`. When unchanged and verified in `worker/wasm/.finance-wasm-build.json`, Rust recompilation is skipped while the `.wasm` binary still undergoes full ABI v2 + 19-export + 0-import + memory safety verification.
- `scripts/verify-worker-bundle.mjs` validates the actual `vite build` output (`dist/company_stock/assets/*atlas_finance_core*.wasm`) byte-for-byte against `worker/wasm/atlas_finance_core.wasm`.

Target automated deployment flow:

`Rust source → WASM compilation → ABI v2 & memory verification → React/Worker build → Bundle WASM verification → Wrangler deployment`

## 2. ABI v2 & Financial Contract

- `FINANCE_CORE_CONTRACT_VERSION = "1.0.0"`, `FINANCE_WASM_ABI_VERSION = 2`.
- **Zero unexpected WASM imports**: `WebAssembly.Module.imports(mod)` must be empty (`[]`), verified in `scripts/build-finance-wasm.mjs`, `scripts/verify-worker-bundle.mjs`, and `initFinanceWasmFromModule()`.
- **All 19 required exports verified before activation** (partial ABIs are rejected):
  - `memory`, `fc_abi_version`, `fc_alloc`, `fc_dealloc`
  - `fc_round2`, `fc_round_dh`, `fc_round6`, `fc_round_with_mode`
  - `fc_is_valid_ymd`, `fc_classify_doc_state`, `fc_classify_doc_remaining`, `fc_days_between`
  - `fc_compute_payroll`, `fc_compute_refund_split`, `fc_compute_invoice_batch`, `fc_apply_bulk_discount`
  - `fc_validate_credit_prefix`, `fc_validate_next_credit_number`, `fc_validate_period`
- **Memory & ABI Safety**:
  - `fc_alloc` enforces `1..=1 MiB` bounds and 8-byte `u64` alignment for `f64` slices; `fc_dealloc` validates pointer/alignment/bounds.
  - All buffer exports (`fc_compute_invoice_batch`, `fc_apply_bulk_discount`, `fc_compute_payroll`, `fc_compute_refund_split`, `fc_validate_credit_prefix`, `fc_validate_period`) validate non-null pointers, maximum bounds, 8-byte alignment, and non-overlapping `in`/`out` ranges with explicit negative error codes and zero panics.

## 3. Local Development (`vite dev` & `wrangler dev`)

- **`npm run dev`** (`vite`): `atlasFinanceWasmPlugin()` in `vite.config.ts` compiles & verifies `worker/wasm/atlas_finance_core.wasm` on startup (cached when unchanged) and watches `rust/atlas-finance-core/src`, `Cargo.toml`, and `rust-toolchain.toml` to rebuild WASM automatically when Rust code changes.
- **`npm run preview`** (`wrangler dev`): `wrangler.jsonc` configures `"build": { "command": "node scripts/build-finance-wasm.mjs --strict", "watch_dir": ["rust/atlas-finance-core/src", "rust/atlas-finance-core/Cargo.toml", "rust-toolchain.toml"] }`, so `wrangler dev` automatically rebuilds WASM whenever Rust sources change.

## 4. Cloudflare Dashboard Build & Deploy Commands

Configure **Cloudflare Workers Builds** (Workers & Pages → `company-stock` → Settings → Builds & deployments) as follows:

| Setting | Exact Value | Notes |
| --- | --- | --- |
| **Production branch** | `main` | Automatic production deploys run **only** from Cloudflare Workers Builds |
| **Build command** | `npm run build` | Automatically ensures Rust `1.82.0` + `wasm32-unknown-unknown`, runs `cargo test` & release WASM build, verifies ABI v2, builds Vite Worker + client, and runs `verify:worker-bundle` |
| **Alternative explicit Build command** | `npm run build:cf` | Explicitly runs `prepare:rust-wasm` before `npm run build` (redundant with `npm run build` inside Cloudflare/CI) |
| **Deploy command** | `npx wrangler deploy` | Uses `.wrangler/deploy/config.json` → `dist/company_stock/wrangler.json` (`no_bundle: true`, includes compiled `.wasm` asset) |
| **Non-production / Preview deploy command** | `npx wrangler versions upload` | Uploads preview version without overwriting production |
| **Build cache directories** (if configured) | `node_modules`, `rust/atlas-finance-core/target`, `~/.cargo` | Avoids reinstalling crates/artifacts across builds |
| **Recommended production env var** | `FINANCE_REQUIRE_WASM = "true"` | Fails closed (`503 FINANCE_ENGINE_UNAVAILABLE`) if WASM is ever absent or invalid |

## 5. GitHub Actions CI & Avoiding Duplicate Production Deployments

- **No duplicate auto-deployments**:
  - **Cloudflare Workers Builds** handles automatic production deployment on every push to `main`.
  - **GitHub Actions** (`.github/workflows/rust-finance-wasm.yml`, `api-guard.yml`, `frontend-guard.yml`) runs **CI verification only** on PRs and pushes to `main` (Rust unit/ABI tests, WASM parity tests with `ATLAS_REQUIRE_WASM=1`, `tsc --noEmit`, `oxlint`, `css-check`, `npm run build`, full `vitest run` including Cloudflare `workerd` tests, and `wrangler deploy --dry-run`).
  - `deploy-production` in `.github/workflows/rust-finance-wasm.yml` is strictly **`workflow_dispatch`** (requires `confirm_deploy == "DEPLOY"` + GitHub **`environment: production`** approval) for manual artifact-pinned deployments/rollbacks using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` without recompiling Rust.

## 6. Worker Observability (`/api/health`)

`GET /api/health` exposes sanitized `data.finance_core` metadata without stack traces or internal error messages:
- `status`: `'wasm_active' | 'typescript_fallback' | 'wasm_initialization_failed' | 'abi_incompatible' | 'wasm_not_bundled'`
- `contract_version`, `engine`, `abi_version`, `wasm_bundled`, `exports_verified`

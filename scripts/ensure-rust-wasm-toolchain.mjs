#!/usr/bin/env node
/**
 * Verifies (and optionally installs in CI / Cloudflare Workers Builds) the pinned
 * Rust toolchain and `wasm32-unknown-unknown` target declared in `rust-toolchain.toml`.
 *
 * Usage:
 *   node scripts/ensure-rust-wasm-toolchain.mjs [--install] [--json]
 *
 * Auto-install triggers when `--install` is passed OR when running inside
 * Cloudflare Workers Builds / CI (`CF_PAGES`, `WORKERS_CI`, `CLOUDFLARE_WORKERS_BUILD`,
 * `CI`, or `ATLAS_AUTO_INSTALL_RUST=1`).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const toolchainTomlPath = resolve(rootDir, 'rust-toolchain.toml');

export function readPinnedToolchain() {
  if (!existsSync(toolchainTomlPath)) {
    throw new Error(`Missing rust-toolchain.toml at ${toolchainTomlPath}`);
  }
  const raw = readFileSync(toolchainTomlPath, 'utf8');
  const channelMatch = raw.match(/^\s*channel\s*=\s*"([^"]+)"/m);
  const targetsMatch = raw.match(/^\s*targets\s*=\s*\[([^\]]*)\]/m);
  const channel = channelMatch?.[1]?.trim() || '1.82.0';
  const targets = targetsMatch
    ? targetsMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    : ['wasm32-unknown-unknown'];
  return { channel, targets };
}

export function augmentCargoPath() {
  const cargoHome = process.env.CARGO_HOME || join(homedir(), '.cargo');
  const cargoBin = join(cargoHome, 'bin');
  const sep = process.platform === 'win32' ? ';' : ':';
  const parts = (process.env.PATH || '').split(sep).filter(Boolean);
  if (existsSync(cargoBin) && !parts.includes(cargoBin)) {
    process.env.PATH = `${cargoBin}${sep}${process.env.PATH || ''}`;
  }
  return cargoBin;
}

function runCapture(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function isAutomatedBuildEnv() {
  return Boolean(
    process.env.CF_PAGES ||
      process.env.WORKERS_CI ||
      process.env.CLOUDFLARE_WORKERS_BUILD ||
      process.env.CI ||
      process.env.ATLAS_AUTO_INSTALL_RUST === '1',
  );
}

export function ensureRustWasmToolchain({ autoInstall = false, quiet = false } = {}) {
  const { channel, targets } = readPinnedToolchain();
  const target = targets[0] || 'wasm32-unknown-unknown';
  const cargoBin = augmentCargoPath();

  const log = (...args) => {
    if (!quiet) console.log('[rust-toolchain]', ...args);
  };

  let rustcVer = runCapture('rustc --version');
  let cargoVer = runCapture('cargo --version');
  let rustupVer = runCapture('rustup --version');

  const needsInstall = !rustcVer || !cargoVer;
  if (needsInstall) {
    if (!autoInstall) {
      throw new Error(
        `Rust toolchain (${channel} + ${target}) is not installed in PATH (searched ${cargoBin}). ` +
          `Install rustup or run "npm run prepare:rust-wasm".`,
      );
    }
    if (process.platform === 'win32') {
      throw new Error('Automatic rustup shell bootstrap is only supported on Linux/macOS CI runners.');
    }
    log(`Installing rustup + pinned toolchain ${channel} (${target})...`);
    execSync(
      `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain ${channel} --profile minimal --target ${target}`,
      { stdio: 'inherit' },
    );
    augmentCargoPath();
    rustcVer = runCapture('rustc --version');
    cargoVer = runCapture('cargo --version');
    rustupVer = runCapture('rustup --version');
    if (!rustcVer || !cargoVer) {
      throw new Error(`rustup installation completed but rustc/cargo are still unavailable in ${cargoBin}.`);
    }
  }

  // Verify version matches pinned channel (e.g. "rustc 1.82.0 (...)")
  if (!rustcVer.includes(channel)) {
    if (rustupVer) {
      log(`Active rustc (${rustcVer}) does not match pinned ${channel}; installing/activating ${channel}...`);
      execSync(`rustup toolchain install ${channel} --profile minimal`, { stdio: 'inherit' });
      execSync(`rustup override set ${channel}`, { stdio: 'inherit', cwd: rootDir });
      rustcVer = runCapture('rustc --version');
    }
    if (!rustcVer || !rustcVer.includes(channel)) {
      throw new Error(`Pinned Rust ${channel} required by rust-toolchain.toml, found: ${rustcVer || 'none'}`);
    }
  }

  // Verify wasm32-unknown-unknown target is installed
  if (rustupVer) {
    const installedTargets = runCapture(`rustup target list --installed --toolchain ${channel}`) || '';
    if (!installedTargets.split(/\r?\n/).includes(target)) {
      log(`Adding Rust target ${target} to toolchain ${channel}...`);
      execSync(`rustup target add ${target} --toolchain ${channel}`, { stdio: 'inherit' });
    }
  } else {
    // Without rustup (e.g. distro rustc), check sysroot target directory
    const sysroot = runCapture('rustc --print sysroot');
    const targetDir = sysroot ? join(sysroot, 'lib', 'rustlib', target) : null;
    if (!targetDir || !existsSync(targetDir)) {
      throw new Error(`Rust target ${target} is missing and rustup is unavailable to install it.`);
    }
  }

  log(`Verified ${rustcVer} with target ${target}.`);
  return { channel, target, rustcVer, cargoVer, cargoBin };
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const installFlag = process.argv.includes('--install') || isAutomatedBuildEnv();
  const jsonFlag = process.argv.includes('--json');
  try {
    const info = ensureRustWasmToolchain({ autoInstall: installFlag, quiet: jsonFlag });
    if (jsonFlag) {
      console.log(JSON.stringify({ ok: true, ...info }));
    }
  } catch (err) {
    console.error('[rust-toolchain] ERROR:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

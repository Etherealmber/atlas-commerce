import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the workflow's actual shell without a checkout or Git repository.
test('triages using explicit repository context in an empty working directory', () => {
  const workflow = readFileSync('.github/workflows/issue-triage.yml', 'utf8');
  const shell = workflow.split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  const dir = mkdtempSync(join(tmpdir(), 'atlas-triage-'));
  try {
    const stub = join(dir, 'gh');
    writeFileSync(stub, '#!/bin/bash\nprintf "%s\\n" "$*" >> "$GH_CALLS"\n'); chmodSync(stub, 0o755);
    const calls = join(dir, 'calls');
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', shell], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_CALLS: calls, GITHUB_REPOSITORY: 'owner/repo', ISSUE: '123', ACTOR: 'human', AUTHOR: 'human', TITLE: 'crash erreur', BODY: 'description' } });
    assert.equal(result.status, 0, result.stderr);
    const commands = readFileSync(calls, 'utf8');
    assert.match(commands, /api -X POST repos\/owner\/repo\/issues\/123\/labels .*labels\[\]=bug/);
    assert.match(commands, /issue comment 123 --repo owner\/repo --body-file ack\.md/);
    assert.match(readFileSync(join(dir, 'ack.md'), 'utf8'), /Bug enregistré/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

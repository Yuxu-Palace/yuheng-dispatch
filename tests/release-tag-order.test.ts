import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import type { PRData } from '../src/utils/types';

type TestPRData = Pick<PRData, 'body' | 'html_url' | 'number' | 'title'> & {
  head: Pick<PRData['head'], 'ref'>;
  labels: Pick<PRData['labels'][number], 'name'>[];
};

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
      continue;
    }

    process.env[key] = value;
  }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function createFixtureRepo(): { rootDir: string; workDir: string } {
  const rootDir = mkdtempSync(join(tmpdir(), 'yuheng-dispatch-release-test-'));
  const remoteDir = join(rootDir, 'remote.git');
  const workDir = join(rootDir, 'worktree');

  runGit(rootDir, ['init', '--bare', remoteDir]);
  runGit(rootDir, ['init', workDir]);

  writeFileSync(
    join(workDir, 'package.json'),
    JSON.stringify(
      {
        name: 'fixture-release-repo',
        version: '0.1.0-beta.3',
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(workDir, 'CHANGELOG.md'),
    `# Changelog

## [v0.1.0-beta.3] - 2026-03-15

### 🐛 Bug Fixes
- 上一个版本
`,
  );

  runGit(workDir, ['config', 'user.name', 'Fixture User']);
  runGit(workDir, ['config', 'user.email', 'fixture@example.com']);
  runGit(workDir, ['add', 'package.json', 'CHANGELOG.md']);
  runGit(workDir, ['commit', '-m', 'chore: init fixture repo']);
  runGit(workDir, ['branch', '-M', 'beta']);
  runGit(workDir, ['remote', 'add', 'origin', remoteDir]);
  runGit(workDir, ['push', '-u', 'origin', 'beta']);

  return { rootDir, workDir };
}

async function test(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

void test('版本标签应指向包含 CHANGELOG 的发布提交', async () => {
  const { rootDir, workDir } = createFixtureRepo();
  const originalCwd = process.cwd();
  const originalEnv = {
    'INPUT_ENABLE-CHANGELOG': process.env['INPUT_ENABLE-CHANGELOG'],
    'INPUT_GIT-USER-EMAIL': process.env['INPUT_GIT-USER-EMAIL'],
    'INPUT_GIT-USER-NAME': process.env['INPUT_GIT-USER-NAME'],
    INPUT_TOKEN: process.env.INPUT_TOKEN,
    'INPUT_VERSION-PREFIX': process.env['INPUT_VERSION-PREFIX'],
  };

  try {
    process.chdir(workDir);
    process.env['INPUT_ENABLE-CHANGELOG'] = 'true';
    process.env['INPUT_VERSION-PREFIX'] = 'v';
    process.env['INPUT_GIT-USER-NAME'] = 'Release Bot';
    process.env['INPUT_GIT-USER-EMAIL'] = 'release-bot@example.com';
    process.env.INPUT_TOKEN = 'test-token';

    const { updateVersionAndCreateTag } = await import('../src/core/git/index');

    const prData = {
      body: '## 变更\n- 修复发布顺序',
      head: { ref: 'feature/release-order' },
      html_url: 'https://example.com/pull/1',
      labels: [{ name: 'patch' }],
      number: 1,
      title: 'fix: 修复发布顺序',
    } satisfies TestPRData;

    await updateVersionAndCreateTag('v0.1.0-beta.4', 'beta', prData as unknown as PRData);

    const headCommit = runGit(workDir, ['rev-parse', 'HEAD']);
    const tagCommit = runGit(workDir, ['rev-list', '-n', '1', 'v0.1.0-beta.4']);
    const taggedChangelog = runGit(workDir, ['show', 'v0.1.0-beta.4:CHANGELOG.md']);
    const pkgInfo = JSON.parse(readFileSync(join(workDir, 'package.json'), 'utf8')) as { version: string };

    assert.equal(tagCommit, headCommit);
    assert.match(taggedChangelog, /## \[v0\.1\.0-beta\.4\]/);
    assert.equal(pkgInfo.version, '0.1.0-beta.4');
  } finally {
    process.chdir(originalCwd);

    restoreEnv(originalEnv);

    rmSync(rootDir, { force: true, recursive: true });
  }
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

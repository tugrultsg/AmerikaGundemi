import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { PROJECT_ROOT, resolveBlogRepoPath } from './config.js';

test('resolves a relative blog repo path from the project root', () => {
  const originalCwd = process.cwd();
  const unrelatedCwd = mkdtempSync(join(tmpdir(), 'amerikagundemi-config-'));

  try {
    process.chdir(unrelatedCwd);
    assert.equal(resolveBlogRepoPath('./blog'), resolve(PROJECT_ROOT, 'blog'));
  } finally {
    process.chdir(originalCwd);
    rmSync(unrelatedCwd, { recursive: true, force: true });
  }
});

test('preserves an absolute blog repo path', () => {
  const absolutePath = resolve(tmpdir(), 'amerikagundemi-blog');
  assert.equal(resolveBlogRepoPath(absolutePath), absolutePath);
});

import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Config } from './types.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

export function loadConfig(): Config {
  const raw = readFileSync(resolve(PROJECT_ROOT, 'config.json'), 'utf-8');
  return JSON.parse(raw) as Config;
}

export function resolveDbPath(dbPath: string): string {
  if (dbPath.startsWith('~')) {
    return dbPath.replace('~', process.env.HOME!);
  }
  return resolve(PROJECT_ROOT, dbPath);
}

export function resolvePromptPath(promptFile: string): string {
  return resolve(PROJECT_ROOT, promptFile);
}

export function resolveBlogRepoPath(repoPath: string): string {
  return isAbsolute(repoPath) ? repoPath : resolve(PROJECT_ROOT, repoPath);
}

export { PROJECT_ROOT };

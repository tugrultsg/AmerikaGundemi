import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePromptPath } from './config.js';
import { logger } from './logger.js';
import type { Config, TranslationOutcome, TranslationResult } from './types.js';

const SUMMARY_ONLY_MARKERS = [
  '---SUMMARY_ARTICLE---',
  '---TITLE---',
  '---GUESTS---',
  '---TAGS---',
  '---THREAD---',
] as const;

type GeneratorResult = { stdout: string; stderr: string; exitCode: number };
type ArticleGenerator = 'codex' | 'claude';

function selectedGenerator(): ArticleGenerator {
  return process.env.ARTICLE_GENERATOR === 'claude' ? 'claude' : 'codex';
}

function invokeArticleGenerator(prompt: string, timeoutMs: number): Promise<GeneratorResult> {
  return selectedGenerator() === 'claude'
    ? invokeClaude(prompt, timeoutMs)
    : invokeCodex(prompt, timeoutMs);
}

function invokeClaude(prompt: string, timeoutMs: number): Promise<GeneratorResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;
    const command = process.env.CLAUDE_CLI || 'claude';

    const child = spawn(command, ['-p', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        resolve({ stdout: '', stderr: 'ETIMEDOUT: Process timed out', exitCode: -1 });
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout: '', stderr: err.message, exitCode: -1 });
      }
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(chunks).toString('utf-8'),
          stderr: Buffer.concat(errChunks).toString('utf-8'),
          exitCode: code ?? -1,
        });
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function invokeCodex(prompt: string, timeoutMs: number): Promise<GeneratorResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;
    const command = process.env.CODEX_CLI || 'codex';
    const tempDir = mkdtempSync(join(tmpdir(), 'amerikagundemi-codex-'));
    const outputFile = join(tempDir, 'last-message.txt');

    const child = spawn(command, [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--cd',
      '/tmp',
      '--output-last-message',
      outputFile,
      '-',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    function cleanup(): void {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors; the generation result is more important.
      }
    }

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill('SIGTERM');
        cleanup();
        resolve({ stdout: '', stderr: 'ETIMEDOUT: Process timed out', exitCode: -1 });
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve({ stdout: '', stderr: err.message, exitCode: -1 });
      }
    });

    child.on('close', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const stdoutLog = Buffer.concat(chunks).toString('utf-8');
        const stderr = Buffer.concat(errChunks).toString('utf-8');
        const finalMessage = existsSync(outputFile) ? readFileSync(outputFile, 'utf-8') : '';
        cleanup();
        resolve({
          stdout: finalMessage,
          stderr: stderr || stdoutLog,
          exitCode: code ?? -1,
        });
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Order-independent section parser. Finds all markers, sorts by position,
// and slices content between them. Works regardless of output order.
function parseSections(raw: string, markers: readonly string[]): Record<string, string> | null {
  const found: { marker: string; pos: number }[] = [];

  for (const marker of markers) {
    const pos = raw.indexOf(marker);
    if (pos === -1) return null;
    found.push({ marker, pos });
  }

  // Sort by position in the output
  found.sort((a, b) => a.pos - b.pos);

  const sections: Record<string, string> = {};
  for (let i = 0; i < found.length; i++) {
    const contentStart = found[i].pos + found[i].marker.length;
    const contentEnd = i + 1 < found.length ? found[i + 1].pos : raw.length;
    sections[found[i].marker] = raw.slice(contentStart, contentEnd).trim();
  }

  return sections;
}

// Extract comma-separated items from a section. Takes only the first line
// (before any blank line or --- marker) and limits to 15 items max.
function parseCommaSeparated(raw: string): string[] {
  const firstLine = raw.split(/\n\n|---/)[0].trim();
  return firstLine
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 80)
    .slice(0, 15);
}

function parseSummaryOnlyOutput(raw: string): Omit<TranslationResult, 'fullTranslation'> | null {
  if (raw.includes('---FULL_TRANSLATION---')) return null;

  const sections = parseSections(raw, SUMMARY_ONLY_MARKERS);
  if (!sections) return null;

  const guests = sections['---GUESTS---'];
  const tags = sections['---TAGS---'];
  const thread = sections['---THREAD---'];

  return {
    summaryArticle: sections['---SUMMARY_ARTICLE---'],
    title: sections['---TITLE---'],
    guests: guests === 'Yok' ? [] : parseCommaSeparated(guests),
    tags: parseCommaSeparated(tags),
    thread: thread
      .split('\n')
      .map((line) => line.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter((line) => line.length > 0),
  };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function attributedQuoteCount(text: string): number {
  const attributionVerbs = 'diyen|dedi|belirtti|açıkladı|vurguladı|ekledi|savundu|ifade etti|değerlendirdi';
  const quoteThenAttribution = new RegExp(`["“][^"”]{20,}["”][^\\n.]{0,180}\\b(${attributionVerbs})\\b`, 'gi');
  const attributionThenQuote = new RegExp(`\\b(${attributionVerbs})\\b[^\\n.]{0,180}["“][^"”]{20,}["”]`, 'gi');

  return (text.match(quoteThenAttribution) ?? []).length
    + (text.match(attributionThenQuote) ?? []).length;
}

function validateSummaryResult(
  result: Omit<TranslationResult, 'fullTranslation'>,
  transcriptWords: number,
): string | null {
  const summaryWords = wordCount(result.summaryArticle);
  const minWords = Math.min(900, Math.max(350, Math.round(transcriptWords * 0.18)));
  const headingCount = (result.summaryArticle.match(/^##\s+/gm) ?? []).length;
  const quoteAttributions = attributedQuoteCount(result.summaryArticle);

  if (summaryWords < minWords) {
    return `Summary article too short: ${summaryWords} words, expected at least ${minWords}`;
  }
  if (headingCount < 3 && transcriptWords > 1200) {
    return `Summary article has too few section headers: ${headingCount}`;
  }
  if (quoteAttributions < 2 && transcriptWords > 1200) {
    return `Summary article has too few attributed direct quotes: ${quoteAttributions}`;
  }
  if (!result.title || result.title.length < 12) {
    return 'Title is missing or too short';
  }
  if (result.tags.length === 0) {
    return 'Tags are missing';
  }
  if (result.thread.length < 5) {
    return `Thread has too few points: ${result.thread.length}`;
  }

  return null;
}

export async function translate(
  transcript: string,
  videoId: string,
  config: Config,
): Promise<TranslationOutcome> {
  const systemPrompt = readFileSync(resolvePromptPath(config.translation.promptFile), 'utf-8');
  const words = wordCount(transcript);
  const generator = selectedGenerator();

  logger.info({ videoId, words, generator }, 'Starting translation');

  const fullPrompt = `${systemPrompt}\n\n---TRANSCRIPT---\n${transcript}`;
  const { stdout, stderr, exitCode } = await invokeArticleGenerator(fullPrompt, config.translation.timeoutSingleMs);

  if (exitCode === -1 && stderr.includes('ETIMEDOUT')) {
    return { ok: false, error: 'timeout', details: `Timed out after ${config.translation.timeoutSingleMs}ms (${words} words)` };
  }
  if (exitCode !== 0) {
    return { ok: false, error: 'cli_error', details: `Exit code ${exitCode}: ${stderr}` };
  }

  const summaryResult = parseSummaryOnlyOutput(stdout);
  if (!summaryResult) {
    return { ok: false, error: 'malformed_output', details: `Missing summary-only section markers (${stdout.length} chars)` };
  }

  const validationError = validateSummaryResult(summaryResult, words);
  if (validationError) {
    return { ok: false, error: 'malformed_output', details: validationError };
  }

  logger.info({ videoId, generator, strategy: 'summary_only' }, 'Translation complete');
  return {
    ok: true,
    result: {
      ...summaryResult,
      fullTranslation: '',
    },
  };
}

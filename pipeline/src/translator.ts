import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolvePromptPath } from './config.js';
import { logger } from './logger.js';
import type { Config, TranslationOutcome, TranslationResult } from './types.js';

const SECTION_MARKERS = [
  '---SUMMARY_ARTICLE---',
  '---FULL_TRANSLATION---',
  '---TITLE---',
  '---GUESTS---',
  '---TAGS---',
  '---THREAD---',
] as const;

const SUMMARY_ONLY_MARKERS = [
  '---SUMMARY_ARTICLE---',
  '---TITLE---',
  '---GUESTS---',
  '---TAGS---',
  '---THREAD---',
] as const;

function invokeClaude(prompt: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const child = spawn('claude', ['-p', '--output-format', 'text'], {
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

// Order-independent section parser. Finds all markers, sorts by position,
// and slices content between them. Works regardless of output order from Claude.
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

function parseStructuredOutput(raw: string): TranslationResult | null {
  const sections = parseSections(raw, SECTION_MARKERS);
  if (!sections) return null;

  const guests = sections['---GUESTS---'];
  const tags = sections['---TAGS---'];
  const thread = sections['---THREAD---'];

  return {
    summaryArticle: sections['---SUMMARY_ARTICLE---'],
    fullTranslation: sections['---FULL_TRANSLATION---'],
    title: sections['---TITLE---'],
    guests: guests === 'Yok' ? [] : parseCommaSeparated(guests),
    tags: parseCommaSeparated(tags),
    thread: thread
      .split('\n')
      .map((line) => line.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter((line) => line.length > 0),
  };
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

function chunkAtParagraphs(text: string, maxWords: number): string[] {
  // Try splitting on paragraph breaks first
  let segments = text.split(/\n\n+/);
  let joiner = '\n\n';

  // If no paragraph breaks (common with YouTube transcripts), split on sentences
  if (segments.length <= 1) {
    segments = text.split(/(?<=[.!?])\s+/);
    joiner = ' ';
  }

  // If still just one segment, force-split on word count
  if (segments.length <= 1) {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += maxWords) {
      chunks.push(words.slice(i, i + maxWords).join(' '));
    }
    return chunks;
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const seg of segments) {
    const segWords = wordCount(seg);
    if (currentWords + segWords > maxWords && current.length > 0) {
      chunks.push(current.join(joiner));
      current = [seg];
      currentWords = segWords;
    } else {
      current.push(seg);
      currentWords += segWords;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(joiner));
  }

  return chunks;
}

function getOverlapContext(previousTranslation: string, words: number): string {
  const allWords = previousTranslation.split(/\s+/);
  return allWords.slice(-words).join(' ');
}

export async function translate(
  transcript: string,
  videoId: string,
  config: Config,
): Promise<TranslationOutcome> {
  const systemPrompt = readFileSync(resolvePromptPath(config.translation.promptFile), 'utf-8');
  const words = wordCount(transcript);

  logger.info({ videoId, words }, 'Starting translation');

  // Single-pass: transcript fits in one invocation
  // Single-pass works for shorter transcripts. For longer ones, the output
  // (summary + full translation) becomes too large and times out.
  // Threshold: ~6000 words input → ~8000 words output is safe for single pass.
  if (words <= 6000) {
    const fullPrompt = `${systemPrompt}\n\n---TRANSCRIPT---\n${transcript}`;
    const { stdout, stderr, exitCode } = await invokeClaude(fullPrompt, config.translation.timeoutSingleMs);

    if (exitCode === -1 && stderr.includes('ETIMEDOUT')) {
      return { ok: false, error: 'timeout', details: `Timed out after ${config.translation.timeoutSingleMs}ms (${words} words)` };
    }
    if (exitCode !== 0) {
      return { ok: false, error: 'cli_error', details: `Exit code ${exitCode}: ${stderr}` };
    }

    const result = parseStructuredOutput(stdout);
    if (!result) {
      return { ok: false, error: 'malformed_output', details: `Missing section markers in output (${stdout.length} chars)` };
    }

    logger.info({ videoId, strategy: 'single' }, 'Translation complete');
    return { ok: true, result };
  }

  // Two-pass: transcript too long
  logger.info({ videoId, words }, 'Transcript too long for single pass, using two-pass strategy');

  // Pass 1: Summary + metadata (no full translation)
  const pass1Prompt = `${systemPrompt}\n\nIMPORTANT: For this invocation, produce only these sections: ---SUMMARY_ARTICLE---, ---TITLE---, ---GUESTS---, ---TAGS---, ---THREAD---. Do NOT produce ---FULL_TRANSLATION---.\n\n---TRANSCRIPT---\n${transcript}`;
  const pass1 = await invokeClaude(pass1Prompt, config.translation.timeoutSingleMs);

  if (pass1.exitCode === -1 && pass1.stderr.includes('ETIMEDOUT')) {
    return { ok: false, error: 'timeout', details: `Pass 1 timed out (${words} words)` };
  }
  if (pass1.exitCode !== 0) {
    return { ok: false, error: 'cli_error', details: `Pass 1 exit code ${pass1.exitCode}: ${pass1.stderr}` };
  }

  const summaryResult = parseSummaryOnlyOutput(pass1.stdout);
  if (!summaryResult) {
    return { ok: false, error: 'malformed_output', details: `Pass 1: Missing section markers (${pass1.stdout.length} chars)` };
  }

  // Pass 2: Chunked full translation
  const chunks = chunkAtParagraphs(transcript, config.translation.chunkSize);
  const translatedChunks: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let chunkPrompt: string;

    if (i === 0) {
      chunkPrompt = `Translate the following podcast transcript excerpt to Turkish. Structure into readable paragraphs with ## section headers where the topic changes. Keep proper nouns in English. Use established Turkish equivalents for US political terms.\n\n---TRANSCRIPT CHUNK ${i + 1}/${chunks.length}---\n${chunk}`;
    } else {
      const overlap = getOverlapContext(translatedChunks[i - 1], 200);
      chunkPrompt = `Continue translating this podcast transcript to Turkish. Maintain consistent terminology with the previous section. Previous translated section ended with:\n\n"${overlap}"\n\n---TRANSCRIPT CHUNK ${i + 1}/${chunks.length}---\n${chunk}`;
    }

    logger.info({ videoId, chunk: i + 1, total: chunks.length }, 'Translating chunk');

    const chunkResult = await invokeClaude(chunkPrompt, config.translation.timeoutChunkMs);

    if (chunkResult.exitCode === -1 && chunkResult.stderr.includes('ETIMEDOUT')) {
      return { ok: false, error: 'timeout', details: `Chunk ${i + 1}/${chunks.length} timed out` };
    }
    if (chunkResult.exitCode !== 0) {
      return { ok: false, error: 'cli_error', details: `Chunk ${i + 1}/${chunks.length} exit ${chunkResult.exitCode}: ${chunkResult.stderr}` };
    }

    translatedChunks.push(chunkResult.stdout.trim());

    // Delay between chunk invocations
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, config.translation.delayBetweenMs));
    }
  }

  const fullTranslation = translatedChunks.join('\n\n');

  logger.info({ videoId, strategy: 'two_pass', chunks: chunks.length }, 'Translation complete');
  return {
    ok: true,
    result: {
      ...summaryResult,
      fullTranslation,
    },
  };
}

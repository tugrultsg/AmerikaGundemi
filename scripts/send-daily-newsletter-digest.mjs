#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_SITE_URL = 'https://gundemamerika.com';
const DEFAULT_SEND_URL = `${DEFAULT_SITE_URL}/api/newsletter/send`;
const DEFAULT_TIME_ZONE = 'America/New_York';
const DEFAULT_MAX_POSTS = 50;

function parseArgs(argv) {
  const args = new Map();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const [name, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue !== undefined) {
      args.set(name, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args.set(name, 'true');
    } else {
      args.set(name, next);
      i += 1;
    }
  }

  return args;
}

function getDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatTurkishDate(dateValue) {
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function normalizeDate(value) {
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function readQuotedScalar(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).replace(/\\"/g, '"');
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  return value;
}

function readFrontmatterField(frontmatter, fieldName) {
  const lines = frontmatter.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith(`${fieldName}:`)) continue;

    let raw = line.slice(fieldName.length + 1).trim();

    if ((raw.startsWith('"') && !raw.endsWith('"')) || (raw.startsWith("'") && !raw.endsWith("'"))) {
      const quote = raw[0];
      for (let j = i + 1; j < lines.length; j += 1) {
        raw += `\n${lines[j]}`;
        if (lines[j].trim().endsWith(quote)) break;
      }
    }

    return readQuotedScalar(raw);
  }

  return null;
}

async function listMarkdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readPost(filePath, siteUrl) {
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const title = readFrontmatterField(frontmatter, 'title');
  const date = readFrontmatterField(frontmatter, 'date');
  const description = readFrontmatterField(frontmatter, 'description');
  if (!title || !date) return null;

  const slug = path.basename(filePath, '.md');
  return {
    date: normalizeDate(String(date)),
    title: String(title),
    url: new URL(`/yazilar/${slug}`, siteUrl).toString(),
    description: description ? String(description) : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const postsDir = path.join(repoRoot, 'blog', 'src', 'content', 'posts');
  const timeZone = args.get('time-zone') ?? process.env.DIGEST_TIME_ZONE ?? DEFAULT_TIME_ZONE;
  const targetDate = args.get('date') ?? process.env.DIGEST_DATE ?? getDateInTimeZone(new Date(), timeZone);
  const maxPosts = Number(args.get('max-posts') ?? process.env.DIGEST_MAX_POSTS ?? DEFAULT_MAX_POSTS);
  const dryRun = args.has('dry-run') || process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const siteUrl = (args.get('site-url') ?? process.env.SITE_URL ?? DEFAULT_SITE_URL).replace(/\/$/, '');
  const sendUrl = args.get('send-url') ?? process.env.NEWSLETTER_SEND_URL ?? DEFAULT_SEND_URL;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error(`Geçersiz tarih: ${targetDate}. YYYY-MM-DD bekleniyor.`);
  }

  if (!Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > DEFAULT_MAX_POSTS) {
    throw new Error(`Geçersiz üst sınır: ${maxPosts}. 1-${DEFAULT_MAX_POSTS} arası olmalı.`);
  }

  const files = await listMarkdownFiles(postsDir);
  const posts = (await Promise.all(files.map((filePath) => readPost(filePath, siteUrl))))
    .filter((post) => post?.date === targetDate)
    .sort((a, b) => a.title.localeCompare(b.title, 'tr'))
    .map(({ date: _date, ...post }) => post);

  if (posts.length === 0) {
    console.log(`Gönderilecek yazı yok: ${targetDate}`);
    return;
  }

  if (posts.length > maxPosts) {
    throw new Error(`${targetDate} için ${posts.length} yazı bulundu; ${maxPosts} üst sınırını aşıyor.`);
  }

  const dateLabel = formatTurkishDate(targetDate);
  const payload = {
    digestKey: `daily-${targetDate}`,
    subject: `Gündem Amerika: ${dateLabel} özeti`,
    posts,
  };

  console.log(`${targetDate} için ${posts.length} yazı hazırlandı.`);
  posts.forEach((post) => console.log(`- ${post.title}`));

  if (dryRun) {
    console.log('Dry run: gönderim yapılmadı.');
    return;
  }

  const token = process.env.NEWSLETTER_ADMIN_TOKEN;
  if (!token) {
    throw new Error('NEWSLETTER_ADMIN_TOKEN gerekli.');
  }

  const response = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(`Bülten gönderimi başarısız: HTTP ${response.status} ${responseBody}`);
  }

  console.log(`Bülten gönderimi tamamlandı: HTTP ${response.status} ${responseBody}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

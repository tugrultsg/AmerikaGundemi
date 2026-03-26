import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { updateVideoStatus, getVideoByVideoId } from './db.js';
import { logger } from './logger.js';
import type { Config, TranslationResult } from './types.js';

const TURKISH_CHAR_MAP: Record<string, string> = {
  ü: 'u', ö: 'o', ç: 'c', ş: 's', ı: 'i', ğ: 'g',
  Ü: 'u', Ö: 'o', Ç: 'c', Ş: 's', İ: 'i', Ğ: 'g',
};

const TITLE_PREFIXES = /^(Dr\.|Prof\.|Sen\.|Rep\.|Gov\.|Mr\.|Mrs\.|Ms\.)\s*/gi;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[üöçşığÜÖÇŞİĞ]/g, (ch) => TURKISH_CHAR_MAP[ch] || ch)
    .replace(TITLE_PREFIXES, '')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugifyGuest(name: string): string {
  return slugify(name.replace(TITLE_PREFIXES, ''));
}

function estimateReadingTime(text: string): number {
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.round(words / 200)); // ~200 words per minute for Turkish
}

function extractDescription(summaryArticle: string): string {
  // Strip markdown headers, bold, links, then take first 2-3 sentences
  const plain = summaryArticle
    .replace(/^#{1,4}\s+.*$/gm, '')  // remove ## headers
    .replace(/\*\*([^*]+)\*\*/g, '$1') // remove **bold**
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // remove [links](url)
    .replace(/\n+/g, ' ')  // collapse newlines
    .replace(/\s+/g, ' ')  // collapse whitespace
    .trim();
  const sentences = plain.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
  return sentences.slice(0, 2).join(' ').slice(0, 250).replace(/"/g, "'");
}

export function formatBlogPost(
  videoId: string,
  channel: string,
  translation: TranslationResult,
  config: Config,
): string {
  const slug = slugify(translation.title);
  const date = new Date().toISOString().split('T')[0];
  const description = extractDescription(translation.summaryArticle);
  const readingTimeSummary = estimateReadingTime(translation.summaryArticle);
  const readingTimeFull = estimateReadingTime(translation.fullTranslation);
  const guestsJson = JSON.stringify(translation.guests);
  const tagsJson = JSON.stringify(translation.tags);

  const frontmatter = [
    '---',
    `title: "${translation.title.replace(/"/g, "'")}"`,
    `date: ${date}`,
    `source: "https://www.youtube.com/watch?v=${videoId}"`,
    `channel: "${channel.replace(/"/g, '\\"')}"`,
    `videoId: "${videoId}"`,
    `description: "${description.replace(/"/g, '\\"')}"`,
    `tags: ${tagsJson}`,
    `guests: ${guestsJson}`,
    `category: "siyaset"`,
    `readingTime:`,
    `  summary: ${readingTimeSummary}`,
    `  full: ${readingTimeFull}`,
    '---',
  ].join('\n');

  return `${frontmatter}\n\n${translation.summaryArticle}\n\n<!-- FULL_TRANSLATION -->\n\n${translation.fullTranslation}\n`;
}

export function formatThread(
  translation: TranslationResult,
  blogUrl: string,
  maxLength: number,
): string[] {
  const points = translation.thread.slice(0, maxLength);
  const total = points.length;

  return points.map((point, i) => {
    const num = `${i + 1}/${total}`;
    const isLast = i === total - 1;

    let tweet = `${num} ${point}`;

    if (isLast) {
      const hashtags = '#ABD #AmerikaSiyaseti';
      tweet = `${num} ${point}\n\n${blogUrl}\n\n${hashtags}`;
    }

    // Truncate if over 280 chars
    if (tweet.length > 280) {
      const suffix = isLast ? `\n\n${blogUrl}\n\n#ABD #AmerikaSiyaseti` : '';
      const maxContent = 280 - num.length - 1 - suffix.length - 3; // 3 for "..."
      tweet = `${num} ${point.slice(0, maxContent)}...${suffix}`;
    }

    return tweet;
  });
}

export function writeBlogPost(
  videoId: string,
  channel: string,
  translation: TranslationResult,
  config: Config,
): string {
  const slug = slugify(translation.title);
  const postsDir = resolve(config.blog.repoPath, 'src', 'content', 'posts');
  const filePath = resolve(postsDir, `${slug}.md`);

  // Idempotent: skip if file already exists
  if (existsSync(filePath)) {
    logger.info({ videoId, filePath }, 'Blog post file already exists, skipping');
    return filePath;
  }

  mkdirSync(postsDir, { recursive: true });
  const content = formatBlogPost(videoId, channel, translation, config);
  writeFileSync(filePath, content, 'utf-8');

  updateVideoStatus(videoId, 'formatted', {
    translated_title: translation.title,
    summary_article: translation.summaryArticle,
    full_translation: translation.fullTranslation,
    tags: JSON.stringify(translation.tags),
    guests: JSON.stringify(translation.guests),
    thread: JSON.stringify(translation.thread),
  });

  logger.info({ videoId, slug, filePath }, 'Blog post written');
  return filePath;
}

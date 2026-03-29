import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import 'dotenv/config';

import { loadConfig, resolveDbPath, PROJECT_ROOT } from './config.js';
import { initDb, getVideoByVideoId, getVideosByStatus, updateVideoStatus, incrementRetryCount, markPermanentlyFailed, resetRetryCount, getAllVideos, getQuotaUsedToday, insertVideo, deleteVideo } from './db.js';
import { logger, alertFailure } from './logger.js';
import { monitorForNewVideos } from './monitor.js';
import { fetchAndCleanTranscript } from './transcript.js';
import { translate } from './translator.js';
import { writeBlogPost, formatThread, slugify } from './formatter.js';
import { fetchQueuedUrls, markProcessed, syncVideosToRemote } from './queue.js';
import { publishBlogPosts } from './publisher-blog.js';
import { publishTwitterThread } from './publisher-twitter.js';
import type { Config, VideoRecord, TranslationResult } from './types.js';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    'video-url': { type: 'string' },
    'skip-twitter': { type: 'boolean', default: false },
    'reprocess': { type: 'string' },
    'from': { type: 'string' },
    'status': { type: 'boolean', default: false },
    'delete': { type: 'string' },
  },
  strict: true,
});

function mountCheck(): boolean {
  if (!existsSync(PROJECT_ROOT)) {
    logger.error({ path: PROJECT_ROOT }, 'Project directory not found — external volume may not be mounted');
    return false;
  }
  return true;
}

function printStatus(): void {
  const videos = getAllVideos();
  const quota = getQuotaUsedToday();

  console.log('\n=== AmerikaGundemi Pipeline Status ===\n');
  console.log(`Today's YouTube API quota usage: ${quota}\n`);

  if (videos.length === 0) {
    console.log('No videos in database.\n');
    return;
  }

  const statusCounts: Record<string, number> = {};
  for (const v of videos) {
    statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
  }

  console.log('Status summary:');
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`);
  }

  console.log(`\nRecent videos (last 20):`);
  console.log('─'.repeat(100));
  console.log(`${'Video ID'.padEnd(14)} ${'Status'.padEnd(22)} ${'Retries'.padEnd(9)} ${'Channel'.padEnd(20)} Title`);
  console.log('─'.repeat(100));

  for (const v of videos.slice(0, 20)) {
    console.log(
      `${v.video_id.padEnd(14)} ${v.status.padEnd(22)} ${String(v.retry_count).padEnd(9)} ${(v.channel || '').slice(0, 19).padEnd(20)} ${(v.title || '').slice(0, 40)}`,
    );
  }
  console.log('');
}

async function processVideo(
  video: VideoRecord,
  config: Config,
  dryRun: boolean,
  skipTwitter: boolean,
): Promise<{ blogReady: boolean; translation?: TranslationResult }> {
  const { video_id: videoId, status, retry_count: retryCount } = video;

  // Check retry limit for error states
  if (['translation_timeout', 'translation_error', 'translation_malformed'].includes(status)) {
    if (retryCount >= config.translation.maxRetries) {
      logger.warn({ videoId, retryCount }, 'Max retries reached, marking as permanently failed');
      markPermanentlyFailed(videoId);
      return { blogReady: false };
    }
  }

  // Stage: Transcript
  if (status === 'pending' || status === 'no_transcript') {
    const result = await fetchAndCleanTranscript(videoId);
    if (!result.success) {
      incrementRetryCount(videoId);
      return { blogReady: false };
    }
  }

  // Reload to get updated status
  const afterTranscript = getVideoByVideoId(videoId)!;

  // Stage: Translation
  if (afterTranscript.status === 'transcribed' || ['translation_timeout', 'translation_error', 'translation_malformed'].includes(afterTranscript.status)) {
    const transcript = afterTranscript.cleaned_transcript!;
    const outcome = await translate(transcript, videoId, config);

    if (!outcome.ok) {
      logger.error({ videoId, error: outcome.error, details: outcome.details }, 'Translation failed');
      updateVideoStatus(videoId, `translation_${outcome.error}` as any, { error_details: outcome.details });
      incrementRetryCount(videoId);
      return { blogReady: false };
    }

    updateVideoStatus(videoId, 'translated', {
      translated_title: outcome.result.title,
      summary_article: outcome.result.summaryArticle,
      full_translation: outcome.result.fullTranslation,
      tags: JSON.stringify(outcome.result.tags),
      guests: JSON.stringify(outcome.result.guests),
      thread: JSON.stringify(outcome.result.thread),
      strategy: 'single', // TODO: track actual strategy from translator
    });
  }

  // Reload again
  const afterTranslation = getVideoByVideoId(videoId)!;

  // Stage: Format
  if (afterTranslation.status === 'translated') {
    const translation: TranslationResult = {
      summaryArticle: afterTranslation.summary_article!,
      fullTranslation: afterTranslation.full_translation!,
      title: afterTranslation.translated_title!,
      guests: JSON.parse(afterTranslation.guests || '[]'),
      tags: JSON.parse(afterTranslation.tags || '[]'),
      thread: JSON.parse(afterTranslation.thread || '[]'),
    };

    if (!dryRun) {
      writeBlogPost(videoId, afterTranslation.channel, translation, config);
    } else {
      logger.info({ videoId, title: translation.title }, 'DRY RUN: Would write blog post');
      updateVideoStatus(videoId, 'formatted');
    }

    return { blogReady: !dryRun, translation };
  }

  // Already formatted or beyond — return current state
  if (afterTranslation.status === 'formatted') {
    const translation: TranslationResult = {
      summaryArticle: afterTranslation.summary_article!,
      fullTranslation: afterTranslation.full_translation!,
      title: afterTranslation.translated_title!,
      guests: JSON.parse(afterTranslation.guests || '[]'),
      tags: JSON.parse(afterTranslation.tags || '[]'),
      thread: JSON.parse(afterTranslation.thread || '[]'),
    };
    return { blogReady: !dryRun, translation };
  }

  return { blogReady: false };
}

async function main(): Promise<void> {
  // Status command — doesn't need mount check
  if (args.status) {
    const config = loadConfig();
    initDb(resolveDbPath(config.db.path));
    printStatus();
    return;
  }

  // Delete command
  if (args.delete) {
    const config = loadConfig();
    initDb(resolveDbPath(config.db.path));
    const videoId = args.delete;
    const video = getVideoByVideoId(videoId);
    if (!video) {
      console.log(`Video ${videoId} not found in database.`);
      process.exit(1);
    }

    // Remove blog post file if it exists
    if (video.translated_title) {
      const { slugify } = await import('./formatter.js');
      const slug = slugify(video.translated_title);
      const postPath = resolve(config.blog.repoPath, 'src', 'content', 'posts', `${slug}.md`);
      if (existsSync(postPath)) {
        unlinkSync(postPath);
        console.log(`Deleted blog post: ${postPath}`);
      }
    }

    deleteVideo(videoId);
    console.log(`Deleted video ${videoId} (${video.title || 'untitled'})`);
    return;
  }

  if (!mountCheck()) {
    process.exit(1);
  }

  // Lock file to prevent concurrent runs
  const lockFile = resolve(process.env.HOME!, '.amerikagundemi', 'pipeline.lock');
  if (existsSync(lockFile)) {
    const lockPid = readFileSync(lockFile, 'utf-8').trim();
    // Check if the process is still running
    try {
      process.kill(Number(lockPid), 0); // signal 0 = just check if alive
      console.log(`Pipeline already running (PID ${lockPid}), skipping.`);
      process.exit(0);
    } catch {
      // Process is dead, stale lock — remove and continue
    }
  }
  writeFileSync(lockFile, String(process.pid));
  process.on('exit', () => { try { unlinkSync(lockFile); } catch {} });
  process.on('SIGINT', () => { try { unlinkSync(lockFile); } catch {} process.exit(1); });
  process.on('SIGTERM', () => { try { unlinkSync(lockFile); } catch {} process.exit(1); });

  const config = loadConfig();
  initDb(resolveDbPath(config.db.path));

  logger.info('Pipeline starting');

  // Handle --reprocess flag
  if (args.reprocess) {
    const videoId = args.reprocess;
    const video = getVideoByVideoId(videoId);
    if (!video) {
      logger.error({ videoId }, 'Video not found in database');
      process.exit(1);
    }

    resetRetryCount(videoId);

    if (args.from) {
      const fromStatus = args.from as any;
      logger.info({ videoId, from: fromStatus }, 'Reprocessing from stage');
      updateVideoStatus(videoId, fromStatus, {
        // Clear downstream data
        ...(fromStatus === 'pending' ? { raw_transcript: null, cleaned_transcript: null, summary_article: null, full_translation: null, tags: null, guests: null, thread: null } : {}),
        ...(fromStatus === 'transcribed' ? { summary_article: null, full_translation: null, tags: null, guests: null, thread: null } : {}),
        error_details: null,
      });
    } else {
      logger.info({ videoId, currentStatus: video.status }, 'Reprocessing from current status');
    }

    const result = await processVideo(getVideoByVideoId(videoId)!, config, args['dry-run']!, args['skip-twitter']!);

    if (result.blogReady && result.translation) {
      await publishBlogPosts([videoId], [result.translation.title]);
    }

    logger.info({ videoId }, 'Reprocessing complete');
    return;
  }

  // Handle --video-url flag
  if (args['video-url']) {
    const url = args['video-url'];
    const videoIdMatch = url.match(/(?:v=|youtu\.be\/|\/live\/)([a-zA-Z0-9_-]{11})/);
    if (!videoIdMatch) {
      logger.error({ url }, 'Could not parse video ID from URL');
      process.exit(1);
    }
    const videoId = videoIdMatch[1];

    // Insert if not exists — fetch real channel name
    const existing = getVideoByVideoId(videoId);
    if (!existing) {
      const { fetchVideoMeta } = await import('./monitor.js');
      const meta = await fetchVideoMeta(videoId);
      const { insertVideo } = await import('./db.js');
      insertVideo(videoId, meta.channel, meta.title);
    }

    const video = getVideoByVideoId(videoId)!;
    const result = await processVideo(video, config, args['dry-run']!, args['skip-twitter']!);

    if (result.blogReady && result.translation) {
      await publishBlogPosts([videoId], [result.translation.title]);

      if (!args['skip-twitter'] && config.twitter.enabled && result.translation.thread.length > 0) {
        const slug = slugify(result.translation.title);
        const blogUrl = `${config.blog.siteUrl}/yazilar/${slug}`;
        const formattedThread = formatThread(result.translation, blogUrl, config.twitter.maxThreadLength);
        await publishTwitterThread(videoId, formattedThread, blogUrl);
      }
    }

    return;
  }

  // Normal pipeline run
  try {
    // Step 0: Fetch queued URLs from remote admin panel (Cloudflare KV)
    const queuedUrls = await fetchQueuedUrls(config);
    for (const qUrl of queuedUrls) {
      const match = qUrl.match(/(?:v=|youtu\.be\/|\/live\/)([a-zA-Z0-9_-]{11})/);
      if (match) {
        const vid = match[1];
        const exists = getVideoByVideoId(vid);
        if (!exists) {
          const { fetchVideoMeta } = await import('./monitor.js');
          const meta = await fetchVideoMeta(vid);
          insertVideo(vid, meta.channel, meta.title);
          logger.info({ videoId: vid, channel: meta.channel }, 'Added video from remote queue');
        }
        await markProcessed(config, vid);
      }
    }

    // Step 1: Monitor for new videos
    const newVideos = await monitorForNewVideos(config);
    logger.info({ newVideos: newVideos.length }, 'New videos found');

    // Get all videos that need processing (new + retryable)
    const pendingVideos = getVideosByStatus('pending');
    const transcribedVideos = getVideosByStatus('transcribed');
    const translatedVideos = getVideosByStatus('translated');
    const formattedVideos = getVideosByStatus('formatted');

    // Collect retryable error videos
    const retryableStatuses = ['translation_timeout', 'translation_error', 'translation_malformed'] as const;
    const retryableVideos: VideoRecord[] = [];
    for (const status of retryableStatuses) {
      retryableVideos.push(...getVideosByStatus(status).filter((v) => v.retry_count < config.translation.maxRetries));
    }

    const allToProcess = [...pendingVideos, ...transcribedVideos, ...translatedVideos, ...retryableVideos];

    // Limit per run
    const toProcess = allToProcess.slice(0, config.translation.maxPerRun);
    logger.info({ total: allToProcess.length, processing: toProcess.length }, 'Videos to process');

    const blogReadyVideos: { videoId: string; translation: TranslationResult }[] = [];

    for (const video of toProcess) {
      const result = await processVideo(video, config, args['dry-run']!, args['skip-twitter']!);

      if (result.blogReady && result.translation) {
        blogReadyVideos.push({ videoId: video.video_id, translation: result.translation });
      }

      // Delay between translation invocations
      if (toProcess.indexOf(video) < toProcess.length - 1) {
        await new Promise((r) => setTimeout(r, config.translation.delayBetweenMs));
      }
    }

    // Also include already-formatted videos waiting for publish
    for (const video of formattedVideos) {
      const translation: TranslationResult = {
        summaryArticle: video.summary_article!,
        fullTranslation: video.full_translation!,
        title: video.translated_title!,
        guests: JSON.parse(video.guests || '[]'),
        tags: JSON.parse(video.tags || '[]'),
        thread: JSON.parse(video.thread || '[]'),
      };
      blogReadyVideos.push({ videoId: video.video_id, translation });
    }

    // Batch publish blog posts
    if (blogReadyVideos.length > 0 && !args['dry-run']) {
      const videoIds = blogReadyVideos.map((v) => v.videoId);
      const titles = blogReadyVideos.map((v) => v.translation.title);
      const published = await publishBlogPosts(videoIds, titles);

      // Post Twitter threads
      if (published && !args['skip-twitter'] && config.twitter.enabled) {
        for (const { videoId, translation } of blogReadyVideos) {
          if (translation.thread.length > 0) {
            const slug = slugify(translation.title);
            const blogUrl = `${config.blog.siteUrl}/yazilar/${slug}`;
            const formattedThread = formatThread(translation, blogUrl, config.twitter.maxThreadLength);
            await publishTwitterThread(videoId, formattedThread, blogUrl);
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      }
    }

    // Sync all videos to remote admin panel
    const allVideosForSync = getAllVideos();
    await syncVideosToRemote(config, allVideosForSync);

    const errorCount = retryableVideos.length;
    logger.info({
      processed: toProcess.length,
      published: blogReadyVideos.length,
      errors: errorCount,
    }, 'Pipeline run complete');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, 'Pipeline failed');
    await alertFailure(`Pipeline failed: ${message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

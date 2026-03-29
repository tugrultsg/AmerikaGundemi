import { logger } from './logger.js';
import type { Config, VideoRecord } from './types.js';

const QUEUE_API = '/api/queue';
const VIDEOS_API = '/api/videos';

export async function fetchQueuedUrls(config: Config): Promise<string[]> {
  const baseUrl = (config.blog as any).workerUrl || config.blog.siteUrl;
  const apiUrl = `${baseUrl}${QUEUE_API}`;

  try {
    const res = await fetch(apiUrl);
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Failed to fetch queue from API');
      return [];
    }

    const data = await res.json() as { urls: { url: string; videoId: string; status: string }[] };
    const urls = data.urls
      .filter((item) => item.status === 'queued')
      .map((item) => item.url);

    logger.info({ count: urls.length }, 'Fetched queued URLs from remote');
    return urls;
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Could not reach queue API');
    return [];
  }
}

export async function markProcessed(config: Config, videoId: string): Promise<void> {
  const baseUrl = (config.blog as any).workerUrl || config.blog.siteUrl;
  const apiUrl = `${baseUrl}${QUEUE_API}`;

  try {
    await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', videoId }),
    });
    logger.info({ videoId }, 'Removed from remote queue');
  } catch {
    // best effort
  }
}

export async function syncVideosToRemote(config: Config, videos: VideoRecord[]): Promise<void> {
  const baseUrl = (config.blog as any).workerUrl || config.blog.siteUrl;
  const apiUrl = `${baseUrl}${VIDEOS_API}`;

  const payload = videos.map((v) => ({
    videoId: v.video_id,
    title: v.title,
    translatedTitle: v.translated_title,
    channel: v.channel,
    status: v.status,
    retryCount: v.retry_count,
    createdAt: v.created_at,
    publishedAt: v.published_at,
  }));

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos: payload }),
    });
    if (res.ok) {
      logger.info({ count: videos.length }, 'Synced videos to remote');
    } else {
      logger.warn({ status: res.status }, 'Failed to sync videos to remote');
    }
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Could not sync videos to remote');
  }
}

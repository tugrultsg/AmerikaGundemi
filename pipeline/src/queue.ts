import { logger } from './logger.js';
import type { Config } from './types.js';

const QUEUE_API = '/api/queue';

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
  const apiUrl = `${baseUrl}${QUEUE_API}?videoId=${videoId}`;

  try {
    await fetch(apiUrl, { method: 'DELETE' });
  } catch {
    // best effort
  }
}

import { youtube, type youtube_v3 } from '@googleapis/youtube';
import { addQuotaUsage, getQuotaUsedToday, getVideoByVideoId, insertVideo } from './db.js';
import { logger } from './logger.js';
import type { Config, NewVideo } from './types.js';

let client: youtube_v3.Youtube;

function getClient(): youtube_v3.Youtube {
  if (!client) {
    client = youtube({
      version: 'v3',
      auth: process.env.YOUTUBE_API_KEY,
    });
  }
  return client;
}

function checkQuota(config: Config): boolean {
  const used = getQuotaUsedToday();
  if (used >= config.youtube.quotaLimit) {
    logger.warn({ used, limit: config.youtube.quotaLimit }, 'YouTube API quota ceiling reached');
    return false;
  }
  return true;
}

async function getUploadsPlaylistId(channelHandle: string, config: Config): Promise<string | null> {
  if (!checkQuota(config)) return null;

  try {
    const yt = getClient();
    // Resolve handle to channel ID
    const searchRes = await yt.search.list({
      part: ['snippet'],
      q: channelHandle,
      type: ['channel'],
      maxResults: 1,
    });
    addQuotaUsage(100); // search.list costs 100 units

    const channelId = searchRes.data.items?.[0]?.snippet?.channelId;
    if (!channelId) return null;

    if (!checkQuota(config)) return null;

    const channelRes = await yt.channels.list({
      part: ['contentDetails'],
      id: [channelId],
    });
    addQuotaUsage(1);

    return channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
  } catch (err) {
    logger.error({ channelHandle, error: err instanceof Error ? err.message : String(err) }, 'Failed to resolve channel');
    return null;
  }
}

async function getVideosFromPlaylist(playlistId: string, config: Config, maxItems = 10): Promise<NewVideo[]> {
  if (!checkQuota(config)) return [];

  try {
    const yt = getClient();
    const res = await yt.playlistItems.list({
      part: ['snippet'],
      playlistId,
      maxResults: maxItems,
    });
    addQuotaUsage(1);

    return (res.data.items ?? [])
      .filter((item) => item.snippet?.resourceId?.videoId)
      .map((item) => ({
        videoId: item.snippet!.resourceId!.videoId!,
        title: item.snippet!.title ?? 'Untitled',
        channel: item.snippet!.channelTitle ?? 'Unknown',
        publishedAt: item.snippet!.publishedAt ?? new Date().toISOString(),
      }));
  } catch (err) {
    logger.error({ playlistId, error: err instanceof Error ? err.message : String(err) }, 'Failed to fetch playlist');
    return [];
  }
}

function parseVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      return parsed.searchParams.get('v');
    }
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1);
    }
  } catch {
    // not a valid URL
  }
  return null;
}

export async function monitorForNewVideos(config: Config): Promise<NewVideo[]> {
  const allVideos: NewVideo[] = [];

  // Fetch from monitored channels
  for (const handle of config.youtube.channels) {
    const uploadsId = await getUploadsPlaylistId(handle, config);
    if (uploadsId) {
      const videos = await getVideosFromPlaylist(uploadsId, config);
      allVideos.push(...videos);
    }
  }

  // Fetch from monitored playlists
  for (const playlistId of config.youtube.playlists) {
    const videos = await getVideosFromPlaylist(playlistId, config);
    allVideos.push(...videos);
  }

  // Manual URLs
  for (const url of config.youtube.manualUrls) {
    const videoId = parseVideoId(url);
    if (videoId) {
      allVideos.push({
        videoId,
        title: 'Manual',
        channel: 'Manual',
        publishedAt: new Date().toISOString(),
      });
    }
  }

  // Deduplicate by videoId and filter already-known
  const seen = new Set<string>();
  const newVideos: NewVideo[] = [];

  for (const video of allVideos) {
    if (seen.has(video.videoId)) continue;
    seen.add(video.videoId);

    const existing = getVideoByVideoId(video.videoId);
    if (existing) continue;

    insertVideo(video.videoId, video.channel, video.title);
    newVideos.push(video);
  }

  logger.info({ found: allVideos.length, new: newVideos.length, quotaUsed: getQuotaUsedToday() }, 'Monitor scan complete');
  return newVideos;
}

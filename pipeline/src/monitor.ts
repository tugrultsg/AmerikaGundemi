import { getVideoByVideoId, insertVideo, updateVideoStatus } from './db.js';
import { logger } from './logger.js';
import type { Config, NewVideo, VideoShortsCheck } from './types.js';

const WATCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; GundemAmerikaBot/1.0)',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Fetch video title and channel name via YouTube's oEmbed endpoint (no API key needed)
async function fetchVideoMeta(videoId: string): Promise<{ title: string; channel: string }> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (res.ok) {
      const data = await res.json() as { title?: string; author_name?: string };
      return {
        title: data.title || videoId,
        channel: data.author_name || 'Bilinmeyen Kanal',
      };
    }
  } catch {
    // oEmbed failed, fall back
  }
  return { title: videoId, channel: 'Bilinmeyen Kanal' };
}

export { fetchVideoMeta };

function parseVideoWatchPage(html: string, videoId: string): VideoShortsCheck {
  const canonicalRaw =
    html.match(/"canonicalUrl"\s*:\s*"([^"]+)"/)?.[1] ??
    html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ??
    null;
  const canonicalUrl = canonicalRaw?.replaceAll('\\/', '/') ?? null;
  const durationRaw = html.match(/"lengthSeconds"\s*:\s*"?(\d+)"?/)?.[1];
  const durationSeconds = durationRaw ? Number(durationRaw) : null;
  const hasShortsCanonical = canonicalUrl?.includes(`/shorts/${videoId}`) || canonicalUrl?.includes('/shorts/');
  const isShortsEligible = /"isShortsEligible"\s*:\s*true/.test(html);

  return {
    checked: true,
    isShort: Boolean(hasShortsCanonical || isShortsEligible),
    durationSeconds,
    canonicalUrl,
    reason: hasShortsCanonical ? 'canonical_shorts' : isShortsEligible ? 'shorts_eligible' : null,
  };
}

export async function checkVideoForShorts(videoId: string): Promise<VideoShortsCheck> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: WATCH_HEADERS,
      redirect: 'follow',
    });

    if (!res.ok) {
      logger.warn({ videoId, status: res.status }, 'Could not check YouTube Shorts metadata');
      return { checked: false, isShort: false, durationSeconds: null, canonicalUrl: null, reason: null };
    }

    return parseVideoWatchPage(await res.text(), videoId);
  } catch (err) {
    logger.warn({ videoId, error: err instanceof Error ? err.message : String(err) }, 'Could not check YouTube Shorts metadata');
    return { checked: false, isShort: false, durationSeconds: null, canonicalUrl: null, reason: null };
  }
}

export function formatSkippedShortDetails(check: VideoShortsCheck): string {
  const duration = check.durationSeconds === null ? 'duration unknown' : `${check.durationSeconds}s`;
  const reason = check.reason ?? 'shorts metadata';
  const canonical = check.canonicalUrl ? `; canonical=${check.canonicalUrl}` : '';
  return `Skipped YouTube Short before transcript (${reason}; ${duration}${canonical})`;
}

/**
 * Extract channel ID from various YouTube channel URL formats.
 * Returns the channel ID or null if the format is unrecognized.
 */
function extractChannelId(url: string): string | null {
  try {
    const parsed = new URL(url);
    // /channel/UC... format — ID is right in the path
    const channelMatch = parsed.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]+)/);
    if (channelMatch) return channelMatch[1];
  } catch {
    // not a valid URL
  }
  return null;
}

/**
 * Resolve a @handle URL to a channel ID by fetching the page
 * and extracting the channel ID from the HTML meta tags.
 */
async function resolveHandleToChannelId(handleUrl: string): Promise<string | null> {
  try {
    const res = await fetch(handleUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Look for canonical channel URL in meta tags or links
    // e.g. <link rel="canonical" href="https://www.youtube.com/channel/UC...">
    const canonicalMatch = html.match(/href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]+)"/);
    if (canonicalMatch) return canonicalMatch[1];

    // Fallback: look for channelId in JSON-LD or embedded data
    const jsonMatch = html.match(/"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]+)"/);
    if (jsonMatch) return jsonMatch[1];

    // Fallback: look for externalId
    const extMatch = html.match(/"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]+)"/);
    if (extMatch) return extMatch[1];
  } catch (err) {
    logger.error({ handleUrl, error: err instanceof Error ? err.message : String(err) }, 'Failed to resolve handle');
  }
  return null;
}

/**
 * Get the channel ID for any YouTube channel URL format.
 */
async function getChannelId(channelUrl: string): Promise<string | null> {
  // Try direct extraction first (cheap, no network)
  const directId = extractChannelId(channelUrl);
  if (directId) return directId;

  // Must be a @handle or other format — resolve via page fetch
  return resolveHandleToChannelId(channelUrl);
}

interface RssEntry {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string;
}

/**
 * Fetch recent videos from a YouTube channel's RSS feed.
 * No API key required — YouTube exposes public RSS feeds for all channels.
 */
async function fetchChannelRss(channelId: string): Promise<RssEntry[]> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

  try {
    const res = await fetch(feedUrl);
    if (!res.ok) {
      logger.warn({ channelId, status: res.status }, 'RSS feed fetch failed');
      return [];
    }

    const xml = await res.text();
    const entries: RssEntry[] = [];

    // Parse entries from the XML feed
    // YouTube RSS uses Atom format with <entry> elements
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];

      const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const authorMatch = entry.match(/<author>\s*<name>([^<]+)<\/name>/);
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);

      if (videoIdMatch) {
        entries.push({
          videoId: videoIdMatch[1],
          title: titleMatch?.[1] ?? 'Untitled',
          channel: authorMatch?.[1] ?? 'Unknown',
          publishedAt: publishedMatch?.[1] ?? new Date().toISOString(),
        });
      }
    }

    return entries;
  } catch (err) {
    logger.error({ channelId, error: err instanceof Error ? err.message : String(err) }, 'Failed to fetch RSS feed');
    return [];
  }
}

/**
 * Fetch recent videos from a YouTube playlist's RSS feed.
 */
async function fetchPlaylistRss(playlistId: string): Promise<RssEntry[]> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;

  try {
    const res = await fetch(feedUrl);
    if (!res.ok) {
      logger.warn({ playlistId, status: res.status }, 'Playlist RSS feed fetch failed');
      return [];
    }

    const xml = await res.text();
    const entries: RssEntry[] = [];

    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];

      const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const authorMatch = entry.match(/<author>\s*<name>([^<]+)<\/name>/);
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);

      if (videoIdMatch) {
        entries.push({
          videoId: videoIdMatch[1],
          title: titleMatch?.[1] ?? 'Untitled',
          channel: authorMatch?.[1] ?? 'Unknown',
          publishedAt: publishedMatch?.[1] ?? new Date().toISOString(),
        });
      }
    }

    return entries;
  } catch (err) {
    logger.error({ playlistId, error: err instanceof Error ? err.message : String(err) }, 'Failed to fetch playlist RSS');
    return [];
  }
}

export function parseVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com')) {
      const v = parsed.searchParams.get('v');
      if (v) return v;
      const liveMatch = parsed.pathname.match(/\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch) return liveMatch[1];
      const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1).split('?')[0];
    }
  } catch {
    // not a valid URL
  }
  return null;
}

export async function monitorForNewVideos(config: Config): Promise<NewVideo[]> {
  const allVideos: NewVideo[] = [];

  // Fetch from monitored channels via RSS
  for (const channelUrl of config.youtube.channels) {
    const channelId = await getChannelId(channelUrl);
    if (!channelId) {
      logger.warn({ channelUrl }, 'Could not resolve channel ID');
      continue;
    }

    const entries = await fetchChannelRss(channelId);
    for (const entry of entries) {
      allVideos.push({
        videoId: entry.videoId,
        title: entry.title,
        channel: entry.channel,
        publishedAt: entry.publishedAt,
      });
    }
    logger.info({ channelUrl, channelId, videos: entries.length }, 'Fetched channel RSS');
  }

  // Fetch from monitored playlists via RSS
  for (const playlistId of config.youtube.playlists) {
    const entries = await fetchPlaylistRss(playlistId);
    for (const entry of entries) {
      allVideos.push({
        videoId: entry.videoId,
        title: entry.title,
        channel: entry.channel,
        publishedAt: entry.publishedAt,
      });
    }
  }

  // Manual URLs — fetch real title/channel from YouTube oEmbed
  for (const url of config.youtube.manualUrls) {
    const videoId = parseVideoId(url);
    if (videoId) {
      const meta = await fetchVideoMeta(videoId);
      allVideos.push({
        videoId,
        title: meta.title,
        channel: meta.channel,
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

    const shortsCheck = await checkVideoForShorts(video.videoId);
    if (shortsCheck.isShort) {
      insertVideo(video.videoId, video.channel, video.title);
      updateVideoStatus(video.videoId, 'skipped_short', {
        error_details: formatSkippedShortDetails(shortsCheck),
      });
      logger.info({
        videoId: video.videoId,
        durationSeconds: shortsCheck.durationSeconds,
        canonicalUrl: shortsCheck.canonicalUrl,
      }, 'Skipped YouTube Short');
      continue;
    }

    insertVideo(video.videoId, video.channel, video.title);
    newVideos.push(video);
  }

  logger.info({ found: allVideos.length, new: newVideos.length }, 'Monitor scan complete');
  return newVideos;
}

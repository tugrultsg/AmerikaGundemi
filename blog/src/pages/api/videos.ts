import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

interface VideoInfo {
  videoId: string;
  title: string | null;
  translatedTitle: string | null;
  channel: string;
  status: string;
  retryCount: number;
  createdAt: string;
  publishedAt: string | null;
}

function getKV(): KVNamespace {
  return (env as any).VIDEO_QUEUE;
}

// GET — list all synced videos
export async function GET(_context: APIContext): Promise<Response> {
  const kv = getKV();
  if (!kv) {
    return Response.json({ error: 'KV yapılandırılmamış' }, { status: 500 });
  }

  const list = await kv.list({ prefix: 'vid:' });
  const videos: VideoInfo[] = [];

  for (const key of list.keys) {
    const val = await kv.get(key.name, 'json') as VideoInfo | null;
    if (val) videos.push(val);
  }

  // Sort by createdAt descending
  videos.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  return Response.json({ videos });
}

// POST — sync videos from pipeline or delete a video
export async function POST(context: APIContext): Promise<Response> {
  const kv = getKV();
  if (!kv) {
    return Response.json({ error: 'KV yapılandırılmamış' }, { status: 500 });
  }

  let body: { action?: string; videoId?: string; videos?: VideoInfo[] };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Geçersiz JSON' }, { status: 400 });
  }

  // Action: delete
  if (body.action === 'delete' && body.videoId) {
    await kv.delete(`vid:${body.videoId}`);
    return Response.json({ message: 'Video silindi', videoId: body.videoId });
  }

  // Action: sync (batch upsert from pipeline)
  if (body.videos && Array.isArray(body.videos)) {
    for (const video of body.videos) {
      if (video.videoId) {
        await kv.put(`vid:${video.videoId}`, JSON.stringify(video));
      }
    }
    return Response.json({ message: `${body.videos.length} video senkronize edildi` });
  }

  return Response.json({ error: 'Geçersiz istek' }, { status: 400 });
}

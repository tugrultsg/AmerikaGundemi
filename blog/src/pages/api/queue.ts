import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

interface QueueItem {
  url: string;
  videoId: string;
  addedAt: string;
  status: string;
}

function getKV(): KVNamespace {
  return (env as any).VIDEO_QUEUE;
}

// GET — list queued URLs
export async function GET(_context: APIContext): Promise<Response> {
  const kv = getKV();
  if (!kv) {
    return Response.json({ error: 'KV yapılandırılmamış' }, { status: 500 });
  }

  const list = await kv.list({ prefix: 'url:' });
  const urls: QueueItem[] = [];

  for (const key of list.keys) {
    const val = await kv.get(key.name, 'json') as QueueItem | null;
    if (val) urls.push(val);
  }

  return Response.json({ urls });
}

// POST — add URL or remove URL (action-based to avoid CSRF issues with DELETE)
export async function POST(context: APIContext): Promise<Response> {
  const kv = getKV();
  if (!kv) {
    return Response.json({ error: 'KV yapılandırılmamış' }, { status: 500 });
  }

  let body: { url?: string; action?: string; videoId?: string };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Geçersiz JSON' }, { status: 400 });
  }

  // Action: remove — delete a video from queue
  if (body.action === 'remove' && body.videoId) {
    await kv.delete(`url:${body.videoId}`);
    return Response.json({ message: 'Kuyruktan silindi', videoId: body.videoId });
  }

  // Default action: add URL
  const url = body.url?.trim();
  if (!url) {
    return Response.json({ error: 'URL gerekli' }, { status: 400 });
  }

  const match = url.match(/(?:v=|youtu\.be\/|\/live\/)([a-zA-Z0-9_-]{11})/);
  if (!match) {
    return Response.json({ error: 'Geçerli bir YouTube URL\'si değil' }, { status: 400 });
  }

  const videoId = match[1];
  const key = `url:${videoId}`;

  const existing = await kv.get(key);
  if (existing) {
    return Response.json({ message: 'Bu video zaten kuyrukta', videoId });
  }

  await kv.put(key, JSON.stringify({
    url,
    videoId,
    addedAt: new Date().toISOString(),
    status: 'queued',
  } satisfies QueueItem));

  return Response.json({ message: 'Video kuyruğa eklendi', videoId }, { status: 201 });
}

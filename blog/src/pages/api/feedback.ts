import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

function getKV(): KVNamespace {
  return (env as any).VIDEO_QUEUE; // reuse same KV namespace
}

// POST — submit feedback (thumbs up/down)
export async function POST(context: APIContext): Promise<Response> {
  const kv = getKV();
  if (!kv) {
    return Response.json({ error: 'KV yapılandırılmamış' }, { status: 500 });
  }

  let body: { videoId?: string; vote?: 'up' | 'down' };
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Geçersiz JSON' }, { status: 400 });
  }

  if (!body.videoId || !body.vote || !['up', 'down'].includes(body.vote)) {
    return Response.json({ error: 'videoId ve vote (up/down) gerekli' }, { status: 400 });
  }

  const key = `feedback:${body.videoId}`;
  const existing = await kv.get(key, 'json') as { up: number; down: number } | null;
  const counts = existing || { up: 0, down: 0 };
  counts[body.vote]++;

  await kv.put(key, JSON.stringify(counts));

  return Response.json({ message: 'Teşekkürler!', counts });
}

// GET — get feedback counts for a video
export async function GET(context: APIContext): Promise<Response> {
  const kv = getKV();
  if (!kv) {
    return Response.json({ error: 'KV yapılandırılmamış' }, { status: 500 });
  }

  const url = new URL(context.request.url);
  const videoId = url.searchParams.get('videoId');
  if (!videoId) {
    return Response.json({ error: 'videoId gerekli' }, { status: 400 });
  }

  const key = `feedback:${videoId}`;
  const counts = await kv.get(key, 'json') as { up: number; down: number } | null;

  return Response.json({ counts: counts || { up: 0, down: 0 } });
}

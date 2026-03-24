import type { APIContext } from 'astro';

export const prerender = false;

// Simple auth via a shared secret in environment variable
function checkAuth(request: Request, env: any): boolean {
  const token = env.ADMIN_TOKEN;
  if (!token) return true; // no token set = open (for initial setup)
  const header = request.headers.get('Authorization');
  return header === `Bearer ${token}`;
}

function getKV(context: APIContext): any {
  // Cloudflare Workers runtime provides env bindings
  return (context.locals as any).runtime?.env?.VIDEO_QUEUE;
}

// GET — list queued URLs
export async function GET(context: APIContext): Promise<Response> {
  const kv = getKV(context);
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const list = await kv.list({ prefix: 'url:' });
  const urls: { url: string; addedAt: string; status: string }[] = [];

  for (const key of list.keys) {
    const val = await kv.get(key.name, 'json');
    if (val) urls.push(val);
  }

  return new Response(JSON.stringify({ urls }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST — add a URL to the queue
export async function POST(context: APIContext): Promise<Response> {
  const env = (context.locals as any).runtime?.env || {};

  if (!checkAuth(context.request, env)) {
    return new Response(JSON.stringify({ error: 'Yetkisiz' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const kv = getKV(context);
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { url?: string };
  try {
    body = await context.request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Geçersiz JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = body.url?.trim();
  if (!url) {
    return new Response(JSON.stringify({ error: 'URL gerekli' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Extract video ID for dedup
  const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!match) {
    return new Response(JSON.stringify({ error: 'Geçerli bir YouTube URL\'si değil' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const videoId = match[1];
  const key = `url:${videoId}`;

  // Check if already queued
  const existing = await kv.get(key);
  if (existing) {
    return new Response(JSON.stringify({ message: 'Bu video zaten kuyrukta', videoId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await kv.put(key, JSON.stringify({
    url,
    videoId,
    addedAt: new Date().toISOString(),
    status: 'queued',
  }));

  return new Response(JSON.stringify({ message: 'Video kuyruğa eklendi', videoId }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

// DELETE — remove a processed URL from queue
export async function DELETE(context: APIContext): Promise<Response> {
  const kv = getKV(context);
  if (!kv) {
    return new Response(JSON.stringify({ error: 'KV not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(context.request.url);
  const videoId = url.searchParams.get('videoId');
  if (!videoId) {
    return new Response(JSON.stringify({ error: 'videoId gerekli' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await kv.delete(`url:${videoId}`);
  return new Response(JSON.stringify({ message: 'Kuyruktan silindi' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

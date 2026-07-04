import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getBaseUrl,
  json,
  sendDigestEmail,
  SUBSCRIBER_PREFIX,
  type EmailBinding,
  type NewsletterPost,
  type SubscriberRecord,
} from '../../../lib/newsletter';

export const prerender = false;

function getKV(): KVNamespace | undefined {
  return (env as any).VIDEO_QUEUE;
}

function getEmail(): EmailBinding | undefined {
  return (env as any).EMAIL;
}

function isAuthorized(request: Request): boolean {
  const configured = (env as any).NEWSLETTER_ADMIN_TOKEN;
  if (typeof configured !== 'string' || configured.length < 16) return false;
  return request.headers.get('authorization') === `Bearer ${configured}`;
}

function validatePosts(posts: unknown): NewsletterPost[] | null {
  if (!Array.isArray(posts) || posts.length === 0 || posts.length > 10) return null;

  const valid: NewsletterPost[] = [];
  for (const post of posts) {
    if (!post || typeof post !== 'object') return null;
    const item = post as Record<string, unknown>;
    if (typeof item.title !== 'string' || typeof item.url !== 'string') return null;
    try {
      const url = new URL(item.url);
      if (url.hostname !== 'gundemamerika.com') return null;
    } catch {
      return null;
    }
    valid.push({
      title: item.title.slice(0, 180),
      url: item.url,
      description: typeof item.description === 'string' ? item.description.slice(0, 260) : undefined,
    });
  }

  return valid;
}

export async function POST(context: APIContext): Promise<Response> {
  if (!isAuthorized(context.request)) {
    return json({ error: 'Yetkisiz istek.' }, { status: 401 });
  }

  const kv = getKV();
  const emailBinding = getEmail();
  if (!kv || !emailBinding) {
    return json({ error: 'Bülten servisi şu anda yapılandırılmamış.' }, { status: 503 });
  }

  let body: { subject?: unknown; posts?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Geçersiz JSON.' }, { status: 400 });
  }

  const posts = validatePosts(body.posts);
  if (!posts) {
    return json({ error: 'Geçerli yazı listesi gerekli.' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.slice(0, 120) : undefined;
  const baseUrl = getBaseUrl(context.request);
  let cursor: string | undefined;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  do {
    const list = await kv.list({ prefix: SUBSCRIBER_PREFIX, cursor, limit: 100 });
    cursor = list.cursor;

    for (const key of list.keys) {
      const subscriber = await kv.get(key.name, 'json') as SubscriberRecord | null;
      if (!subscriber || subscriber.status !== 'active') {
        skipped++;
        continue;
      }

      const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${subscriber.unsubscribeToken}`;
      try {
        await sendDigestEmail(emailBinding, env as any, subscriber, posts, unsubscribeUrl, subject);
        sent++;
      } catch {
        failed++;
      }
    }
  } while (cursor);

  return json({ sent, skipped, failed });
}

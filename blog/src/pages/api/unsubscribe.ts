import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  htmlPage,
  subscriberKey,
  unsubscribeKey,
  type SubscriberRecord,
} from '../../lib/newsletter';

export const prerender = false;

function getKV(): KVNamespace | undefined {
  return (env as any).VIDEO_QUEUE;
}

export async function GET(context: APIContext): Promise<Response> {
  const kv = getKV();
  if (!kv) {
    return htmlPage('Bülten yapılandırılmamış', 'Bülten servisi şu anda kullanılamıyor.', 503);
  }

  const token = new URL(context.request.url).searchParams.get('token')?.trim();
  if (!token) {
    return htmlPage('Geçersiz bağlantı', 'Abonelikten çıkma bağlantısı eksik veya hatalı.', 400);
  }

  const tokenRecord = await kv.get(unsubscribeKey(token), 'json') as { emailHash?: string } | null;
  if (!tokenRecord?.emailHash) {
    return htmlPage('Bağlantı geçersiz', 'Bu abonelikten çıkma bağlantısı geçersiz.', 400);
  }

  const key = subscriberKey(tokenRecord.emailHash);
  const subscriber = await kv.get(key, 'json') as SubscriberRecord | null;
  if (!subscriber) {
    await kv.delete(unsubscribeKey(token));
    return htmlPage('Abonelik bulunamadı', 'Bu bağlantıya ait abonelik kaydı bulunamadı.', 404);
  }

  const now = new Date().toISOString();
  const updated: SubscriberRecord = {
    ...subscriber,
    status: 'unsubscribed',
    unsubscribedAt: now,
    updatedAt: now,
  };

  await kv.put(key, JSON.stringify(updated));
  await kv.delete(unsubscribeKey(token));

  return htmlPage('Abonelikten çıkıldı', 'Gündem Amerika bülten aboneliğiniz iptal edildi.');
}

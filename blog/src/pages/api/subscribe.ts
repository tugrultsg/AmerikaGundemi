import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import {
  confirmationKey,
  isValidEmail,
  json,
  getBaseUrl,
  normalizeEmail,
  parseEmailRequest,
  randomToken,
  rateKey,
  sendConfirmationEmail,
  sha256,
  subscriberKey,
  unsubscribeKey,
  type EmailBinding,
  type SubscriberRecord,
} from '../../lib/newsletter';

export const prerender = false;

function getKV(): KVNamespace | undefined {
  return (env as any).VIDEO_QUEUE;
}

function getEmail(): EmailBinding | undefined {
  return (env as any).EMAIL;
}

export async function POST(context: APIContext): Promise<Response> {
  const kv = getKV();
  const emailBinding = getEmail();

  if (!kv || !emailBinding) {
    return json({ error: 'Bülten servisi şu anda yapılandırılmamış.' }, { status: 503 });
  }

  let rawEmail: string | null;
  try {
    rawEmail = await parseEmailRequest(context.request);
  } catch {
    return json({ error: 'Geçersiz istek.' }, { status: 400 });
  }

  const email = normalizeEmail(rawEmail ?? '');
  if (!isValidEmail(email)) {
    return json({ error: 'Geçerli bir e-posta adresi girin.' }, { status: 400 });
  }

  const emailHash = await sha256(email);
  const limited = await kv.get(rateKey(emailHash));
  if (limited) {
    return json({ message: 'Onay e-postası gönderildiyse gelen kutunuzu kontrol edin.' });
  }

  await kv.put(rateKey(emailHash), '1', { expirationTtl: 300 });

  const now = new Date().toISOString();
  const existing = await kv.get(subscriberKey(emailHash), 'json') as SubscriberRecord | null;
  if (existing?.status === 'active') {
    return json({ message: 'Bu e-posta zaten bültene kayıtlı.' });
  }

  const unsubscribeToken = existing?.unsubscribeToken ?? randomToken();
  const confirmToken = randomToken();
  const subscriber: SubscriberRecord = {
    email,
    emailHash,
    status: 'pending',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    confirmationSentAt: now,
    unsubscribeToken,
  };

  await kv.put(subscriberKey(emailHash), JSON.stringify(subscriber));
  await kv.put(confirmationKey(confirmToken), JSON.stringify({ emailHash }), { expirationTtl: 60 * 60 * 24 });
  await kv.put(unsubscribeKey(unsubscribeToken), JSON.stringify({ emailHash }));

  const confirmUrl = `${getBaseUrl(context.request)}/api/confirm?token=${confirmToken}`;
  try {
    await sendConfirmationEmail(emailBinding, env as any, subscriber, confirmUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'E-posta gönderilemedi.';
    return json({ error: message }, { status: 502 });
  }

  return json({ message: 'Onay e-postası gönderildi. Aboneliği tamamlamak için bağlantıya tıklayın.' });
}

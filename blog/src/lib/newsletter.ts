export type SubscriberStatus = 'pending' | 'active' | 'unsubscribed';

export interface SubscriberRecord {
  email: string;
  emailHash: string;
  status: SubscriberStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  unsubscribedAt?: string;
  confirmationSentAt?: string;
  unsubscribeToken: string;
}

export interface NewsletterPost {
  title: string;
  url: string;
  description?: string;
}

export interface EmailBinding {
  send(message: {
    to: string | { email: string; name?: string };
    from: string | { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string | { email: string; name?: string };
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}

export const SUBSCRIBER_PREFIX = 'newsletter:subscriber:';
const CONFIRM_PREFIX = 'newsletter:confirm:';
const UNSUBSCRIBE_PREFIX = 'newsletter:unsubscribe:';
const RATE_PREFIX = 'newsletter:rate:';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function subscriberKey(emailHash: string): string {
  return `${SUBSCRIBER_PREFIX}${emailHash}`;
}

export function confirmationKey(token: string): string {
  return `${CONFIRM_PREFIX}${token}`;
}

export function unsubscribeKey(token: string): string {
  return `${UNSUBSCRIBE_PREFIX}${token}`;
}

export function rateKey(emailHash: string): string {
  return `${RATE_PREFIX}${emailHash}`;
}

export function getBaseUrl(request: Request): string {
  const configured = (import.meta.env.PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, '');
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function getSender(runtimeEnv: Record<string, unknown>): string {
  const email = typeof runtimeEnv.NEWSLETTER_FROM === 'string'
    ? runtimeEnv.NEWSLETTER_FROM
    : 'bulten@gundemamerika.com';
  return email;
}

export function getReplyTo(runtimeEnv: Record<string, unknown>): string {
  const email = typeof runtimeEnv.NEWSLETTER_REPLY_TO === 'string'
    ? runtimeEnv.NEWSLETTER_REPLY_TO
    : 'info@gundemamerika.com';
  return email;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function parseEmailRequest(request: Request): Promise<string | null> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body = await request.json() as { email?: unknown };
    return typeof body.email === 'string' ? body.email : null;
  }

  const formData = await request.formData();
  const email = formData.get('email');
  return typeof email === 'string' ? email : null;
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

export function htmlPage(title: string, message: string, status = 200): Response {
  const body = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Gündem Amerika</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 12vh auto; padding: 0 24px; line-height: 1.6; color: #111827; }
    a { color: #b91c1c; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a href="/">Gündem Amerika ana sayfasına dön</a></p>
</body>
</html>`;

  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function sendConfirmationEmail(
  emailBinding: EmailBinding,
  runtimeEnv: Record<string, unknown>,
  subscriber: SubscriberRecord,
  confirmUrl: string,
): Promise<void> {
  const from = getSender(runtimeEnv);
  const replyTo = getReplyTo(runtimeEnv);
  const html = `<p>Gündem Amerika bültenine aboneliğinizi onaylamak için aşağıdaki bağlantıya tıklayın:</p>
<p><a href="${escapeHtml(confirmUrl)}">${escapeHtml(confirmUrl)}</a></p>
<p>Bu isteği siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.</p>`;
  const text = `Gündem Amerika bültenine aboneliğinizi onaylamak için bağlantıyı açın:\n\n${confirmUrl}\n\nBu isteği siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.`;

  await emailBinding.send({
    to: subscriber.email,
    from,
    replyTo,
    subject: 'Gündem Amerika bülten aboneliğinizi onaylayın',
    html,
    text,
  });
}

export async function sendDigestEmail(
  emailBinding: EmailBinding,
  runtimeEnv: Record<string, unknown>,
  subscriber: SubscriberRecord,
  posts: NewsletterPost[],
  unsubscribeUrl: string,
  subject = 'Gündem Amerika: Yeni yazılar',
): Promise<void> {
  const from = getSender(runtimeEnv);
  const replyTo = getReplyTo(runtimeEnv);
  const itemsHtml = posts.map((post) => `<li>
  <a href="${escapeHtml(post.url)}">${escapeHtml(post.title)}</a>
  ${post.description ? `<br><span>${escapeHtml(post.description)}</span>` : ''}
</li>`).join('');
  const itemsText = posts.map((post) => `- ${post.title}\n  ${post.url}${post.description ? `\n  ${post.description}` : ''}`).join('\n\n');

  await emailBinding.send({
    to: subscriber.email,
    from,
    replyTo,
    subject,
    html: `<p>Gündem Amerika'da yeni yazılar yayımlandı:</p><ul>${itemsHtml}</ul><p><a href="${escapeHtml(unsubscribeUrl)}">Abonelikten çık</a></p>`,
    text: `Gündem Amerika'da yeni yazılar yayımlandı:\n\n${itemsText}\n\nAbonelikten çık: ${unsubscribeUrl}`,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
    },
  });
}

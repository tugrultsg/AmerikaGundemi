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

function renderEmailLayout(options: {
  preheader: string;
  title: string;
  lede: string;
  contentHtml: string;
  footerHtml?: string;
}): string {
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} | Gündem Amerika</title>
</head>
<body style="margin:0;padding:0;background:#f8f9fa;color:#111827;font-family:Inter,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8f9fa;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #e5e7eb;border-top:5px solid #dc2626;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:24px 24px 14px;border-bottom:1px solid #e5e7eb;">
              <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;line-height:1;">
                <span style="color:#dc2626;">GÜNDEM</span><span style="color:#111827;">AMERİKA</span>
              </div>
              <div style="margin-top:8px;color:#6b7280;font-size:13px;line-height:1.5;">ABD gündemine dair Türkçe özet makaleler</div>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;color:#111827;font-size:28px;line-height:1.2;">${escapeHtml(options.title)}</h1>
              <p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.65;">${escapeHtml(options.lede)}</p>
              ${options.contentHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 24px;background:#111827;color:#9ca3af;font-size:12px;line-height:1.6;">
              ${options.footerHtml ?? '<p style="margin:0;">Bu e-posta Gündem Amerika bülten aboneliğinizle ilgilidir.</p>'}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
  const safeConfirmUrl = escapeHtml(confirmUrl);
  const html = renderEmailLayout({
    preheader: 'Gündem Amerika bülten aboneliğinizi onaylayın.',
    title: 'Bülten aboneliğinizi onaylayın',
    lede: 'Yeni özet makaleler yayımlandığında e-postayla haber almak için aboneliğinizi tamamlayın.',
    contentHtml: `<p style="margin:0 0 22px;color:#4b5563;font-size:15px;line-height:1.65;">Bu isteği siz başlattıysanız aşağıdaki bağlantıyla aboneliği etkinleştirebilirsiniz.</p>
<p style="margin:0 0 22px;"><a href="${safeConfirmUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 18px;border-radius:4px;">Aboneliği onayla</a></p>
<p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">Buton çalışmazsa bu bağlantıyı tarayıcınızda açın:<br><a href="${safeConfirmUrl}" style="color:#dc2626;word-break:break-all;">${safeConfirmUrl}</a></p>`,
    footerHtml: '<p style="margin:0;">Bu isteği siz başlatmadıysanız bu e-postayı yok sayabilirsiniz.</p>',
  });
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
  const itemsHtml = posts.map((post) => `<article style="border-top:1px solid #e5e7eb;padding:16px 0;">
  <h2 style="margin:0 0 8px;font-size:18px;line-height:1.35;color:#111827;"><a href="${escapeHtml(post.url)}" style="color:#111827;text-decoration:none;">${escapeHtml(post.title)}</a></h2>
  ${post.description ? `<p style="margin:0 0 12px;color:#4b5563;font-size:14px;line-height:1.6;">${escapeHtml(post.description)}</p>` : ''}
  <a href="${escapeHtml(post.url)}" style="color:#dc2626;font-size:13px;font-weight:700;text-decoration:none;">Yazıyı oku</a>
</article>`).join('');
  const itemsText = posts.map((post) => `- ${post.title}\n  ${post.url}${post.description ? `\n  ${post.description}` : ''}`).join('\n\n');
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl);
  const html = renderEmailLayout({
    preheader: 'Gündem Amerika’da yeni yazılar yayımlandı.',
    title: 'Yeni yazılar',
    lede: 'ABD gündemindeki son podcast ve haber programlarından hazırlanan Türkçe özetler.',
    contentHtml: itemsHtml,
    footerHtml: `<p style="margin:0 0 8px;">Gündem Amerika bültenine kayıtlı olduğunuz için gönderildi.</p>
<p style="margin:0;"><a href="${safeUnsubscribeUrl}" style="color:#fca5a5;">Abonelikten çık</a></p>`,
  });

  await emailBinding.send({
    to: subscriber.email,
    from,
    replyTo,
    subject,
    html,
    text: `Gündem Amerika'da yeni yazılar yayımlandı:\n\n${itemsText}\n\nAbonelikten çık: ${unsubscribeUrl}`,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
    },
  });
}

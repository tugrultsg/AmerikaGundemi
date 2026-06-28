import { adsensePublisherId } from '../lib/adsense';

export const prerender = true;

export function GET() {
  const body = adsensePublisherId
    ? `google.com, ${adsensePublisherId}, DIRECT, f08c47fec0942fa0\n`
    : '';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

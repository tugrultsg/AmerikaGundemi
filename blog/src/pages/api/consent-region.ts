import type { APIContext } from 'astro';

export const prerender = false;

type CloudflareRequest = Request & {
  cf?: {
    country?: string;
  };
};

const CONSENT_COUNTRY_CODES = new Set([
  'AT',
  'BE',
  'BG',
  'CH',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GB',
  'GR',
  'HR',
  'HU',
  'IE',
  'IS',
  'IT',
  'LI',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'NO',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'TR',
]);

function normalizeCountry(country: string | null | undefined): string | null {
  const normalized = country?.trim().toUpperCase();
  if (!normalized || normalized === 'XX') return null;
  return normalized;
}

function getLocalCountryOverride(context: APIContext): string | null {
  const hostname = new URL(context.request.url).hostname;
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return null;
  return normalizeCountry(new URL(context.request.url).searchParams.get('country'));
}

export function GET(context: APIContext): Response {
  const request = context.request as CloudflareRequest;
  const country = normalizeCountry(
    getLocalCountryOverride(context) ?? request.cf?.country ?? context.request.headers.get('cf-ipcountry'),
  );

  return Response.json(
    {
      country,
      requiresConsent: country ? CONSENT_COUNTRY_CODES.has(country) : true,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        Vary: 'CF-IPCountry',
      },
    },
  );
}

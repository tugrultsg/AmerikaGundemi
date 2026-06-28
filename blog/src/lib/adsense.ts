const rawPublisherId = import.meta.env.PUBLIC_ADSENSE_PUBLISHER_ID?.trim() ?? '';

function normalizePublisherId(value: string): string {
  const normalized = value.replace(/^ca-/, '');
  return /^pub-\d+$/.test(normalized) ? normalized : '';
}

export const adsensePublisherId = normalizePublisherId(rawPublisherId);
export const adsenseClientId = adsensePublisherId ? `ca-${adsensePublisherId}` : '';
export const isAdsenseEnabled = Boolean(adsenseClientId);

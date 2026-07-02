function routeSlug(value: string, fallback: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[\\/]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
}

export function tagSlug(tag: string): string {
  return routeSlug(tag, 'etiket');
}

export function channelSlug(channel: string): string {
  return routeSlug(channel, 'kanal');
}

type RateLimitEntry = {
  count: number;
  reset: number;
};

const buckets = new Map<string, RateLimitEntry>();

export function isRateLimited(
  key: string,
  { limit = 60, windowMs = 60_000 }: { limit?: number; windowMs?: number } = {},
): boolean {
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now > entry.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

export function getRateLimitConfig(pathname: string) {
  if (pathname.startsWith('/api/cron')) {
    return { limit: 5, windowMs: 60_000 };
  }

  if (pathname.startsWith('/api/auth')) {
    return { limit: 10, windowMs: 60_000 };
  }

  if (pathname.startsWith('/api/bot')) {
    return { limit: 20, windowMs: 60_000 };
  }

  return { limit: 100, windowMs: 60_000 };
}

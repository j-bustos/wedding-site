const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 10;

/** HMAC-SHA256(ip, salt) — never store or log the raw IP. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ip));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sliding-window-ish rate limit backed by D1: max MAX_REQUESTS per ipHash per
 * WINDOW_MS. Returns false when the caller should be rejected with 429.
 */
export async function checkRateLimit(db: D1Database, ipHash: string): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare('SELECT window_start, count FROM rate_limit_lookup WHERE ip_hash = ?')
    .bind(ipHash)
    .first<{ window_start: number; count: number }>();

  if (!row) {
    await db
      .prepare('INSERT INTO rate_limit_lookup (ip_hash, window_start, count) VALUES (?, ?, 1)')
      .bind(ipHash, now)
      .run();
    return true;
  }

  if (now - row.window_start > WINDOW_MS) {
    await db
      .prepare('UPDATE rate_limit_lookup SET window_start = ?, count = 1 WHERE ip_hash = ?')
      .bind(now, ipHash)
      .run();
    return true;
  }

  if (row.count >= MAX_REQUESTS) {
    return false;
  }

  await db
    .prepare('UPDATE rate_limit_lookup SET count = count + 1 WHERE ip_hash = ?')
    .bind(ipHash)
    .run();
  return true;
}

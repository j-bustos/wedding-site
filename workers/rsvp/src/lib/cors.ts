/**
 * Builds CORS response headers. ALLOWED_ORIGIN is a comma-separated list
 * (production origin, plus localhost in dev via env.dev.vars). Only echoes
 * back Access-Control-Allow-Origin when the request's Origin is on the list.
 */
export function corsHeaders(origin: string | null, allowedOrigin: string): Record<string, string> {
  const allowed = allowedOrigin.split(',').map((o) => o.trim());
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };

  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

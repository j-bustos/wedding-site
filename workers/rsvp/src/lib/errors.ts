/** Structured JSON error responses — never leak stack traces to clients. */
export function jsonError(status: number, message: string, code?: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ status: 'error', message, code }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

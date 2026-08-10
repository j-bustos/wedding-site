const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Verifies a Turnstile token server-side. Never trust a client-only check. */
export async function verifyTurnstile(
  token: string | undefined,
  secret: string,
  remoteIp?: string
): Promise<boolean> {
  if (!token) return false;

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (remoteIp) body.set('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body });
    if (!res.ok) return false;
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

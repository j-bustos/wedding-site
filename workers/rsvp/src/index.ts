import type { Env } from './types';
import { corsHeaders } from './lib/cors';
import { jsonError } from './lib/errors';
import { handleLookup } from './routes/lookup';
import { handleRsvp } from './routes/rsvp';
import { handleAdminExport } from './routes/admin-export';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === '/api/lookup' && request.method === 'POST') {
        return await handleLookup(request, env, cors);
      }
      if (url.pathname === '/api/rsvp' && request.method === 'POST') {
        return await handleRsvp(request, env, cors);
      }
      if (url.pathname === '/api/admin/export' && request.method === 'GET') {
        return await handleAdminExport(request, env);
      }
      return jsonError(404, 'Not found', 'NOT_FOUND', cors);
    } catch (err) {
      console.error('Unhandled error', err);
      return jsonError(500, 'Internal server error', 'INTERNAL_ERROR', cors);
    }
  },
};

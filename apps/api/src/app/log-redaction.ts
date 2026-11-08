/**
 * Log hygiene (spec §8: never log tokens). Fastify's request log records the URL, which for
 * `GET /join/:token` holds the raw invite token and for `/auth/callback?code=…&state=…` the
 * OIDC authorization code.
 */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q);
  if (path === '/auth/callback' || path.startsWith('/auth/callback/')) return path;
  return path.replace(/^\/join\/[^/]+/, '/join/[redacted]') + query;
}

export interface LoggableRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined> | undefined;
  host?: string | undefined;
  ip?: string | undefined;
  socket?: { remotePort?: number | undefined } | undefined;
}

/** Same shape as Fastify's default `req` serializer, with the URL redacted. */
export function serializeRequest(req: LoggableRequest) {
  const version = req.headers?.['accept-version'];
  return {
    method: req.method,
    url: redactUrl(req.url),
    version: Array.isArray(version) ? version[0] : version,
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}

// Atlas Ferroviario — AWS Lambda entry point. Runs the same request handler as the local server (server.mjs) behind a
// Lambda Function URL that only CloudFront can invoke (origin access control). CloudFront serves the static files from
// S3, so only /api/* reaches this function. Errors are answered generically; details stay in the function's log.

import { handle, ready } from './server.mjs';

export async function handler(event) {
  await ready; // a cold start answers only once the timetable and the rail network are loaded
  // CloudFront appends the viewer's address as the last X-Forwarded-For entry; earlier entries come from the client.
  const forwarded = (event.headers?.['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const req = {
    method: event.requestContext.http.method,
    url: event.rawPath + (event.rawQueryString ? `?${event.rawQueryString}` : ''),
    socket: { remoteAddress: forwarded.at(-1) ?? event.requestContext.http.sourceIp },
  };
  return new Promise((resolve) => {
    let statusCode = 200;
    const headers = {};
    const res = {
      setHeader: (k, v) => { headers[k.toLowerCase()] = String(v); },
      writeHead: (status, h = {}) => { statusCode = status; for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v); },
      end: (body = '') => resolve({ statusCode, headers, body: Buffer.from(body).toString('base64'), isBase64Encoded: true }),
    };
    handle(req, res).catch((err) => {
      console.error(err);
      resolve({ statusCode: 500, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: '{"error":"Error interno"}' });
    });
  });
}

import { createServer } from 'node:http';

export function json(response, value, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}
export function xml(response, value) { response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(value); }
export function escapeXml(value) { return String(value).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]); }
export const remoteIp = request => request.socket.remoteAddress?.replace(/^::ffff:/, '');
export function hubAllowed(request, hubs) { return hubs.includes(remoteIp(request)); }
export async function body(request) {
  const parts = []; let size = 0;
  for await (const part of request) { size += part.length; if (size > 16384) throw new Error('Request body is too large.'); parts.push(part); }
  const value = JSON.parse(Buffer.concat(parts).toString() || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
  return value;
}
export function makeServer(handler) {
  const server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => { if (!res.headersSent) json(res, { error: 'Request failed.' }, 500); else res.end(); }); });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 3000;
  return server;
}
export async function listen(server, port, host = '0.0.0.0') {
  await new Promise((resolve, reject) => {
    const failed = error => { server.removeListener('listening', ready); reject(error); };
    const ready = () => { server.removeListener('error', failed); resolve(); };
    server.once('error', failed); server.once('listening', ready); server.listen(port, host);
  });
  return server.address().port;
}
export async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}

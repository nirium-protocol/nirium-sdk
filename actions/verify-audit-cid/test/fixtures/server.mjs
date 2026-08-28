import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);

const routes = new Map([
  ['/ipfs/valid-audit', 'valid-audit.json'],
  ['/ipfs/tampered-audit', 'tampered-audit.json'],
]);

const server = http.createServer(async (req, res) => {
  const pathname = req.url ? new URL(req.url, `http://127.0.0.1:${port}`).pathname : '';
  const fixture = routes.get(pathname);
  if (!fixture) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'fixture not found' }));
    return;
  }

  const body = await fs.readFile(path.join(__dirname, fixture), 'utf8');
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`fixture gateway listening on ${port}`);
});

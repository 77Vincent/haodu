import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const directories = ['src', 'test'].map(name => join(root, name) + sep);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Only expose browser fixtures and their source dependencies on this machine.
createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = await realpath(resolve(root, '.' + (path === '/' ? '/test/extension-fixture.html' : path)));
    if (!directories.some(directory => file.startsWith(directory)) || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', error => response.destroy(error)).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(8765, '127.0.0.1', () => {
  console.log('浏览器测试页：http://127.0.0.1:8765/test/extension-fixture.html');
  console.log('按 Ctrl+C 停止服务。');
});

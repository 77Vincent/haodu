import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const site = fileURLToPath(new URL('../site/', import.meta.url));
const envFile = join(site, '.env.local');
if (existsSync(envFile)) loadEnvFile(envFile);

const configArgs = process.env.SITE_CONFIG
  ? ['--config', resolve(site, process.env.SITE_CONFIG)] : [];
const env = { ...process.env };
if (process.env.SITE_STATIC_DIR) {
  const source = resolve(site, process.env.SITE_STATIC_DIR);
  if (!statSync(source).isDirectory()) throw new Error(`Not a static directory: ${source}`);
  // Preserve the project's mounts and serve private assets without copying them into source.
  const config = JSON.parse(execFileSync('hugo', [
    'config', '--format', 'json', '--environment', 'development', ...configArgs,
  ], { cwd: site, env, encoding: 'utf8' }));
  env.HUGO_MODULE_MOUNTS = JSON.stringify([
    ...config.module.mounts, { source, target: 'static' },
  ]);
}

const server = spawn('hugo', [
  'server', '--bind', '127.0.0.1', '--renderToMemory', '--disableFastRender', '--noHTTPCache',
  ...configArgs, ...process.argv.slice(2),
], { cwd: site, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
});

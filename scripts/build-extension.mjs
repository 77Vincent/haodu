import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { parseArgs } from 'node:util';
import { extensionTarget } from './extension-targets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const { values } = parseArgs({ options: { browser: { type: 'string', default: 'chrome' } } });
// Explicit target allowlists never walk the repository or include site/training.
const sourceManifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const target = extensionTarget(sourceManifest, values.browser);
const { files, manifest } = target;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
if (manifest.manifest_version !== 3 || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
  throw new Error('Expected a Manifest V3 extension with a numeric version.');
}
const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (metadata.version !== manifest.version) throw new Error('package.json and manifest.json versions differ.');
const references = [
  ...(manifest.background?.service_worker ? [manifest.background.service_worker] : []),
  ...(manifest.background?.scripts || []),
  ...(manifest.action?.default_popup ? [manifest.action.default_popup] : []),
  ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.web_accessible_resources || []).flatMap(({ resources }) => resources),
];
for (const path of references) {
  if (!files.includes(path)) throw new Error(`Manifest resource is missing from the package: ${path}`);
}

await mkdir(dist, { recursive: true });
const temporary = await mkdtemp(join(dist, '.extension-'));
try {
  const unpacked = join(temporary, target.directory);
  const entries = [];
  for (const path of files) {
    const source = join(root, path);
    // Reject symlinks as well as special files instead of following them.
    if (!(await lstat(source)).isFile()) throw new Error(`Not a regular release file: ${path}`);
    const bytes = path === 'manifest.json' && values.browser !== 'chrome'
      ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n') : await readFile(source);
    if (path.endsWith('.js')) new Script(bytes.toString('utf8'), { filename: path });
    const target = join(unpacked, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    await chmod(target, 0o644);
    // Stable ZIP timestamps; local time avoids timezone-dependent ZIP dates.
    const stamp = new Date(2000, 0, 1);
    await utimes(target, stamp, stamp);
    entries.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const archiveName = target.archive;
  const archive = join(temporary, archiveName);
  // zip is provided by macOS and the Ubuntu release runner. No recursive input.
  execFileSync('zip', ['-X', '-q', '-9', archive, ...files], { cwd: unpacked });
  const archiveBytes = await readFile(archive);
  const report = {
    name: manifest.name, version: manifest.version, browser: values.browser,
    unpackedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    archive: archiveName, archiveBytes: archiveBytes.length,
    archiveSha256: sha256(archiveBytes), files: entries,
  };
  await writeFile(join(temporary, target.report), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(temporary, `${archiveName}.sha256`), `${report.archiveSha256}  ${archiveName}\n`);
  // Only replace owned artifacts after a successful build. Keep older versions.
  await rm(join(dist, target.directory), { recursive: true, force: true });
  for (const name of [target.directory, archiveName, `${archiveName}.sha256`, target.report]) {
    await rename(join(temporary, name), join(dist, name));
  }
  console.log(`Extension (${values.browser}): dist/${target.directory}/ (${entries.length} files, ${(report.unpackedBytes / 1e6).toFixed(2)} MB)`);
  console.log(`Extension ZIP: dist/${archiveName} (${(archiveBytes.length / 1e6).toFixed(2)} MB)`);
  console.log(`SHA-256: ${report.archiveSha256}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

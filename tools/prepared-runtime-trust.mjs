import { readFile, realpath, lstat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installationDirectory } from './storage.mjs';

// Resolve from executing code, including its bundled kernel location. A project
// may select an installed version; it cannot nominate a new Node module owner.
let executingPackage;
async function packageRoot() {
  for (let root = dirname(fileURLToPath(import.meta.url)); ; root = dirname(root)) {
    const pkg = await readFile(join(root, 'package.json'), 'utf8')
      .then(JSON.parse)
      .catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    if (pkg?.name === '@visual-storytelling/core') return realpath(root);
    if (dirname(root) === root)
      throw new Error('Cannot locate the executing Visual Storytelling package.');
  }
}

/** The installer owns trusted releases; authored scene metadata is never executable authority. */
export async function assertPreparedRuntimeRoot(root) {
  const canonical = await realpath(root);
  executingPackage ??= packageRoot();
  const owner = await executingPackage;
  if (canonical === owner) return canonical;
  // A developer explicitly runs this checkout; its own generated release is the
  // same trust boundary. This does not permit a release beneath an opened project.
  const development = await realpath(join(owner, '.plugin-release')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (development === canonical) return canonical;
  const releases = await realpath(join(installationDirectory(), 'releases')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const rejected = () =>
    new Error('The prepared runtime must be an installed immutable Visual Storytelling release.');
  if (!releases || dirname(canonical) !== releases) throw rejected();
  const folder = await lstat(canonical);
  if (!folder.isDirectory() || folder.uid !== process.getuid() || folder.mode & 0o222)
    throw rejected();
  const receiptFile = join(canonical, '.installation.json');
  const files = [
    receiptFile,
    ...['package.json', 'dist/build-info.json', 'dist/explanation/document.js'].map((file) =>
      join(canonical, file),
    ),
  ];
  for (const file of files) {
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o222 ||
      (await realpath(file)) !== file
    )
      throw rejected();
  }
  const receipt = JSON.parse(await readFile(receiptFile, 'utf8'));
  if (
    !/^[a-f0-9]{64}$/.test(receipt.digest) ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(receipt.version) ||
    basename(canonical) !== `${receipt.version}-${receipt.digest.slice(0, 16)}`
  )
    throw rejected();
  return canonical;
}

import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

export const sourceHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (root, file) => {
  const path = relative(root, file).split(sep).join('/');
  return path && !path.startsWith('../') ? path : undefined;
};

/** Build inputs, not the reviewing CLI's checkout, own source links in a capture. */
export async function writeSourceReferences(bundle, metafile, { directory, runtimeRoot }) {
  const inputs = [];
  directory = await realpath(directory);
  if (runtimeRoot) runtimeRoot = await realpath(runtimeRoot);
  for (const input of Object.keys(metafile.inputs)) {
    // Inline entry points and other virtual modules have no local owner to open.
    let file;
    try {
      file = await realpath(resolve(input));
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
      throw error;
    }
    const local = within(directory, file),
      runtime = runtimeRoot && within(runtimeRoot, file),
      references = [];
    if (local && !local.split('/').includes('node_modules')) references.push(local);
    if (runtime?.startsWith('src/')) references.push(runtime);
    if (runtime?.startsWith('dist/') && runtime.endsWith('.js'))
      references.push(runtime.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'));
    if (!references.length) continue;
    inputs.push({
      file,
      hash: sourceHash(await readFile(file)),
      references: [...new Set(references)],
    });
  }
  await writeFile(
    bundle + '.sources.json',
    JSON.stringify({ version: 1, bundle: sourceHash(await readFile(bundle)), inputs }) + '\n',
  );
}

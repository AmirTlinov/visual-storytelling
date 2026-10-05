import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const optional = (file) =>
  readFile(file, 'utf8').catch((error) => {
    if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw error;
  });

/** The emitted bundle carries notices from its actual inputs, including embedded sub-bundles. */
export async function writeBundleNotices(bundle, metafile, { assets = [] } = {}) {
  const packages = new Set(),
    notices = new Set();
  const inputs = new Set([...Object.keys(metafile.inputs), ...assets]);
  for (const input of [...inputs].sort()) {
    const file = resolve(input);
    if (
      !(await stat(file).then(
        (s) => s.isFile(),
        (error) => {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
          return false;
        },
      ))
    )
      continue;
    const inherited = file !== bundle && (await optional(file + '.LICENSE.txt'));
    if (inherited) notices.add(inherited);
    if (file.includes('/three/examples/jsm/libs/draco/'))
      notices.add(
        'Draco decoder · Apache-2.0\n\n' +
          (await readFile(new URL('./licenses/draco-LICENSE.txt', import.meta.url), 'utf8')),
      );
    let directory = dirname(file);
    while (directory !== dirname(directory)) {
      const manifest = await optional(join(directory, 'package.json'));
      if (manifest) {
        if (packages.has(directory)) break;
        packages.add(directory);
        const pkg = JSON.parse(manifest);
        for (const name of (await readdir(directory))
          .filter((name) => /^(?:licen[sc]e|notice|copying)(?:\.|-|$)/i.test(name))
          .sort()) {
          const text = await optional(join(directory, name));
          if (text) notices.add(`${pkg.name} ${pkg.version} · ${name}\n\n${text}`);
        }
        break;
      }
      directory = dirname(directory);
    }
  }
  await writeFile(bundle + '.LICENSE.txt', [...notices].join('\n\n' + '='.repeat(72) + '\n\n'));
}

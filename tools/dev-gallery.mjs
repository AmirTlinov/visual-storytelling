import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { develop } from './dev.mjs';

const path = (name) => fileURLToPath(new URL('../' + name, import.meta.url));
const server = await develop(path('examples'), 8793, {
  output: path('site'),
  watch: [path('src'), path('tools')],
  // Re-read authoring code too, including the renderer and catalog's ESM dependencies.
  build: async (_source, output) => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      path('tools/build.mjs'),
      output,
    ]);
    process.stdout.write(stdout);
  },
});
console.log(server.url);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });

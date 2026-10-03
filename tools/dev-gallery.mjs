import { fileURLToPath } from 'node:url';
import { develop } from './dev.mjs';
import { buildGallery } from './build.mjs';

const path = (name) => fileURLToPath(new URL('../' + name, import.meta.url));
const server = await develop(path('examples'), 8793, {
  output: path('site'),
  watch: [path('src')],
  build: (_source, output) => buildGallery(output),
});
console.log(server.url);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });

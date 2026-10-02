import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/assets', { recursive: true });
await Promise.all([
  cp('src/assets', 'dist/assets', { recursive: true }),
  cp('src/style.css', 'dist/style.css'),
]);

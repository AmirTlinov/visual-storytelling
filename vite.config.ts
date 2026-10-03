import { defineConfig } from 'vite';
import { sourceAliases } from './tools/source-package.mjs';

export default defineConfig({
  root: 'examples',
  resolve: { alias: sourceAliases },
});

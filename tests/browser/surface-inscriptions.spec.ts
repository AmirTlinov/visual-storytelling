import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import type { verifyInscriptions } from '../fixtures/surface-inscriptions.js';

test('material inscriptions fit their surface and retain their strokes during scale and seek', async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import { verifyInscriptions } from './tests/fixtures/surface-inscriptions.ts';
        import { loadFonts } from './src/ink/fonts.ts'; import './dist/style.css';
        window.ready = loadFonts().then(verifyInscriptions);`,
    },
    bundle: true,
    format: 'iife',
    outfile: 'inscriptions.js',
    write: false,
    loader: { '.woff2': 'dataurl' },
  });
  await page.setContent('<!doctype html><title>Material inscriptions</title>');
  await page.addStyleTag({
    content: bundle.outputFiles.find((f) => f.path.endsWith('.css'))!.text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((f) => f.path.endsWith('.js'))!.text,
  });
  const result = await page.evaluate(
    () => (window as unknown as { ready: Promise<ReturnType<typeof verifyInscriptions>> }).ready,
  );
  expect(result.fontGain, 'wrapping increases the actual size of the strokes').toBeGreaterThan(1.4);
  for (const [key, value] of Object.entries(result))
    if (key !== 'fontGain' && key !== 'bounds')
      expect(value, `${key}: ${JSON.stringify(result.bounds)}`).toBe(true);
});

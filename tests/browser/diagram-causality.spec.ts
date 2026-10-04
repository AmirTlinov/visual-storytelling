import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

test('diagrams reveal dependencies before results and preserve causal state on rewind', async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import { flowDiagram, comparisonDiagram } from './dist/recipes/index.js';
        import { surface, theme } from './dist/ink/index.js';
        import { loadFonts } from './dist/ink/fonts.js';
        import './dist/style.css';
        window.diagrams = { flowDiagram, comparisonDiagram, surface, theme, ready: loadFonts() };`,
    },
    bundle: true,
    format: 'iife',
    outfile: 'diagrams.js',
    write: false,
    loader: { '.woff2': 'dataurl' },
  });
  await page.setContent('<!doctype html><main style="width:640px;height:480px"></main>');
  await page.addStyleTag({
    content: bundle.outputFiles.find((f) => f.path.endsWith('.css'))!.text,
  });
  await page.addScriptTag({
    content: bundle.outputFiles.find((f) => f.path.endsWith('.js'))!.text,
  });
  const result = await page.evaluate(async () => {
    const { flowDiagram, comparisonDiagram, surface, theme, ready } = (window as any).diagrams;
    await ready;
    const parent = document.querySelector('main')!;
    const colors = theme(parent, 'light');
    const view = surface(parent, {
      id: 'causality',
      width: 640,
      height: 480,
      title: 'Связи',
      description: '',
    });
    // Deliberately shuffled nodes and links: storage order carries no dependency semantics.
    const flow = flowDiagram(view, {
      nodes: [
        { id: 'output', label: 'Нагрев' },
        { id: 'rule', label: 'Сравнить' },
        { id: 'input', label: 'Датчик' },
        { id: 'target', label: 'Порог' },
      ],
      edges: [
        { from: 'rule', to: 'output' },
        { from: 'target', to: 'rule' },
        { from: 'input', to: 'rule' },
      ],
      values: () => ({ input: 18, target: 22, rule: '18 < 22', output: 'включён' }),
    });
    const frame = (progress: number, mode = 'story') => ({
      progress,
      time: progress * 10,
      mode,
      reduced: false,
      values: {},
    });
    const samples = [];
    for (const width of [640, 360]) {
      view.resize(width, 480, false);
      for (const progress of [0, 0.25, 0.5, 1, 0]) {
        flow.render(frame(progress), { width, height: 480 });
        samples.push({
          width,
          progress,
          ...flow.snapshot(),
          description: view.element.querySelector('desc').textContent,
          signals: [...view.element.querySelectorAll('[data-object^="flow-signal-"]')].filter(
            (n: any) => getComputedStyle(n).display !== 'none',
          ).length,
        });
      }
    }
    flow.dispose();
    const comparison = comparisonDiagram(view, {
      items: [
        { id: 'a', label: 'Температура' },
        { id: 'b', label: 'Порог' },
      ],
      maximum: 30,
      values: () => ({ a: 18, b: 22 }),
      conclusion: () => 'Нагрев включён',
    });
    const bars = [0.3, 1, 0.3].map((p) => {
      comparison.render(frame(p), { width: 360, height: 480 });
      return comparison.snapshot();
    });
    comparison.render(frame(0, 'explore'), { width: 360, height: 480 });
    const explored = comparison.snapshot();
    comparison.dispose();
    view.dispose();
    colors.dispose();
    return { samples, bars, explored };
  });
  for (const s of result.samples) {
    expect(s.revealed.sort()).toEqual(
      s.progress < 0.5
        ? ['input', 'target']
        : s.progress < 1
          ? ['input', 'rule', 'target']
          : ['input', 'output', 'rule', 'target'],
    );
    expect(s.signals).toBe(s.progress < 0.5 ? 2 : s.progress < 1 ? 1 : 0);
    expect(s.description.includes('включён')).toBe(s.progress === 1);
  }
  expect(result.bars[0].conclusion).toBe('');
  expect(result.bars[1].conclusion).toBe('Нагрев включён');
  expect(result.bars[2]).toEqual(result.bars[0]);
  expect(result.explored.drawn).toEqual({ a: 18, b: 22 });
  expect(result.explored.conclusion).toBe('Нагрев включён');
});

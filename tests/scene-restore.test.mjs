import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assetURLs } from '../tools/asset-urls.mjs';

test(
  'restoration supersedes preparation and preserves atomic conditions and history',
  { timeout: 15000 },
  async (t) => {
    const bundle = await build({
      stdin: {
        contents:
          "import {SceneShell} from './src/scene.ts'; import {story} from './src/story/story.ts'; import {mountScene} from './src/scene-handle.ts'; import './src/style.css'; window.API={SceneShell,story,mountScene};",
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: 'iife',
      write: false,
      outdir: '.',
      plugins: [assetURLs()],
      loader: { '.woff2': 'dataurl' },
    });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setContent('<main></main>');
      await page.addStyleTag({
        content: bundle.outputFiles.find((file) => file.path.endsWith('.css')).text,
      });
      await page.addScriptTag({
        content: bundle.outputFiles.find((file) => file.path.endsWith('.js')).text,
      });
      await page.evaluate(async () => {
        await API.SceneShell.ready();
        window.create = () => {
          window.lab?.scene.dispose();
          const root = document.querySelector('main'),
            gates = new Map(),
            prepared = new Set([0, 2, 3]),
            aborted = [],
            rendered = [],
            views = [];
          let authored = 0,
            selected = [];
          const gate = (value) => {
            if (!gates.has(value)) {
              let resolve, reject;
              const promise = new Promise((yes, no) => {
                resolve = yes;
                reject = no;
              });
              gates.set(value, {
                promise,
                reject,
                resolve() {
                  prepared.add(value);
                  resolve();
                },
              });
            }
            return gates.get(value);
          };
          const shell = API.SceneShell.mount(root, {
            title: 'Restore',
            parameters: ['value', 'low', 'high'].map((key) => ({
              key,
              label: key,
              value: 0,
              min: 0,
              max: 10,
            })),
          });
          const controller = shell.attachStory({
            script: { duration: 10, cues: {} },
            stateAt: () => ({ value: authored, low: 0, high: 0 }),
            derive(values) {
              if (values.low > values.high) throw new Error('low exceeds high');
              return values;
            },
            prepare({ value }, _frame, _mode, signal) {
              if (prepared.has(value)) return;
              signal.addEventListener('abort', () => aborted.push(value));
              return gate(value).promise;
            },
            render(values) {
              rendered.push({ ...values });
            },
          });
          shell.attachView({
            capture: () => ({ id: 'initial' }),
            restore(value) {
              views.push(value.id);
              return true;
            },
            reset() {},
            dispose() {},
          });
          const scene = root.scene;
          scene.extend({
            objects: () => [{ id: 'a' }, { id: 'b' }],
            get selected() {
              return selected;
            },
            select(ids) {
              selected = [...ids];
            },
          });
          window.lab = {
            shell,
            controller,
            scene,
            gates,
            gate,
            prepared,
            aborted,
            rendered,
            views,
            setAuthored(value) {
              authored = value;
            },
          };
        };
      });
      await t.test('Undo cancels a pending load, including a later rejection', async () => {
        const result = await page.evaluate(async () => {
          create();
          lab.shell.input({ value: 1 });
          await lab.scene.undoExperiment();
          lab.gate(1).reject(new Error('cancelled load failed'));
          await Promise.resolve();
          await lab.controller.ready();
          return {
            value: lab.scene.snapshot().value,
            phase: lab.controller.phase,
            aborted: lab.aborted,
            history: lab.scene.experimentHistory,
          };
        });
        assert.deepEqual(result, {
          value: 0,
          phase: 'ready',
          aborted: [1],
          history: { undo: false, redo: true },
        });
        const afterFailure = await page.evaluate(async () => {
          create();
          lab.shell.input({ value: 1 });
          lab.gate(1).reject(new Error('load failed'));
          await lab.controller.ready().catch(() => {});
          await lab.scene.undoExperiment();
          return { value: lab.scene.snapshot().value, phase: lab.controller.phase };
        });
        assert.deepEqual(afterFailure, { value: 0, phase: 'ready' });
      });
      await t.test(
        'same-context restore accepts dependent inputs and time before prepare',
        async () => {
          const result = await page.evaluate(async () => {
            create();
            lab.shell.input({ value: 2, low: 2, high: 2 });
            const saved = { ...lab.scene.capture(), time: 4 };
            lab.setAuthored(9);
            lab.shell.input({ value: 1, low: 0, high: 0 });
            await lab.scene.restore(saved);
            return {
              values: lab.scene.snapshot(),
              time: lab.controller.currentTime,
              authorLoad: lab.gates.has(9),
              aborted: lab.aborted,
            };
          });
          assert.deepEqual(result, {
            values: { value: 2, low: 2, high: 2 },
            time: 4,
            authorLoad: false,
            aborted: [1],
          });
        },
      );
      await t.test(
        'newer restore owns view and selection; rapid undo/redo retains both steps',
        async () => {
          const result = await page.evaluate(async () => {
            create();
            lab.shell.input({ value: 2 });
            const saved = lab.scene.capture();
            const old = lab.scene
              .restore({
                ...saved,
                values: { ...saved.values, value: 1 },
                view: { id: 'old' },
                selected: ['a'],
              })
              .then(
                () => null,
                (error) => error.code,
              );
            const latest = lab.scene.restore({ ...saved, view: { id: 'latest' }, selected: ['b'] });
            const code = await old;
            await latest;
            lab.gate(1).resolve();
            await Promise.resolve();
            const restored = {
              value: lab.scene.snapshot().value,
              views: [...lab.views],
              selected: [...lab.scene.selected],
              code,
            };
            lab.shell.input({ value: 3 });
            lab.shell.input({ value: 0 });
            await Promise.all([lab.scene.undoExperiment(), lab.scene.undoExperiment()]);
            const undone = lab.scene.snapshot().value;
            await Promise.all([lab.scene.redoExperiment(), lab.scene.redoExperiment()]);
            return { restored, undone, redone: lab.scene.snapshot().value };
          });
          assert.deepEqual(result, {
            restored: {
              value: 2,
              views: ['latest'],
              selected: ['b'],
              code: 'scene_restore_superseded',
            },
            undone: 2,
            redone: 0,
          });
          const edited = await page.evaluate(async () => {
            create();
            lab.shell.input({ value: 2 });
            const saved = lab.scene.capture();
            const restoring = lab.scene
              .restore({
                ...saved,
                values: { ...saved.values, value: 1 },
                view: { id: 'obsolete' },
              })
              .then(
                () => null,
                (error) => error.code,
              );
            lab.shell.input({ value: 3 });
            return { code: await restoring, value: lab.scene.snapshot().value, views: lab.views };
          });
          assert.deepEqual(edited, { code: 'scene_restore_superseded', value: 3, views: [] });
        },
      );
      await t.test(
        'input during asynchronous playback restore supersedes its later view and selection',
        async () => {
          const result = await page.evaluate(async () => {
            create();
            lab.shell.input({ value: 2 });
            let release, started;
            const pending = new Promise((resolve) => (release = resolve));
            const entered = new Promise((resolve) => (started = resolve));
            lab.scene.extend({
              muted: true,
              async mute(value) {
                started();
                await pending;
                this.muted = value;
              },
            });
            const restoring = lab.scene
              .restore({
                ...lab.scene.capture(),
                muted: false,
                view: { id: 'obsolete' },
                selected: ['a'],
              })
              .then(
                () => null,
                (error) => error.code,
              );
            await entered;
            lab.shell.input({ value: 3 });
            release();
            return {
              code: await restoring,
              value: lab.scene.snapshot().value,
              views: lab.views,
              selected: [...lab.scene.selected],
            };
          });
          assert.deepEqual(result, {
            code: 'scene_restore_superseded',
            value: 3,
            views: [],
            selected: [],
          });
        },
      );
      await t.test(
        'subject-only structured input supersedes pending restore without applying its camera',
        async () => {
          const result = await page.evaluate(async () => {
            lab.scene.dispose();
            const root = document.querySelector('main');
            const shell = API.SceneShell.mount(root, {
              title: 'Structured condition',
              parameters: [{ key: 'x', label: 'X', value: 1, min: 0, max: 10 }],
            });
            let delayed = false;
            const views = [];
            shell.attachView({
              capture: () => ({ id: 'saved' }),
              restore(value) { views.push(value.id); },
              reset() {},
              dispose() {},
            });
            const controller = shell.attachStory({
              script: { duration: 10, cues: {} },
              stateAt: () => ({ x: 1, tensor: [[0]] }),
              checkpoint: {
                encode: (values) => structuredClone(values),
                decode: (value) => structuredClone(value),
              },
              prepare(values) {
                if (delayed && values.tensor[0][0] === 1) return new Promise(() => {});
              },
              render() {},
            });
            controller.input({ tensor: [[1]] });
            const saved = root.scene.capture();
            controller.input({ tensor: [[0]] });
            delayed = true;
            const restoring = root.scene.restore(saved).then(
              () => 'succeeded',
              (error) => error.code,
            );
            const condition = root.scene.condition;
            const unchanged = condition === root.scene.condition;
            await Promise.resolve();
            controller.input({ tensor: [[9]] });
            const result = {
              code: await restoring,
              values: root.scene.snapshot(),
              views,
              identityStable: unchanged,
              identityChanged: condition !== root.scene.condition,
            };
            root.scene.dispose();
            return result;
          });
          assert.deepEqual(result, {
            code: 'scene_restore_superseded',
            values: { x: 1, tensor: [[9]] },
            views: [],
            identityStable: true,
            identityChanged: true,
          });
        },
      );
      await t.test(
        'fallback seek accepts its condition before waiting for preparation',
        async () => {
          const result = await page.evaluate(async () => {
            lab.scene.dispose();
            let release;
            const pending = new Promise((resolve) => (release = resolve));
            const views = [];
            const controller = API.story({
              script: { duration: 10, cues: {} },
              stateAt: (frame) => ({ value: frame.time }),
              prepare: ({ value }) => (value === 4 ? pending : undefined),
              render() {},
            });
            const scene = API.mountScene(document.querySelector('main'), {
              snapshot: () => controller.presented.state,
              ready: controller.ready,
              pause: controller.pause,
              seek: controller.seek,
              duration: 10,
              get currentTime() {
                return controller.currentTime;
              },
              get rendering() {
                return {
                  phase: controller.phase,
                  requested: controller.requested,
                  presented: controller.presented,
                };
              },
              camera: {
                restore(view) {
                  views.push(view.id);
                },
                reset() {},
                dispose() {},
              },
              dispose: controller.dispose,
            });
            const restoring = scene.restore({
              time: 4,
              progress: 0,
              mode: 'story',
              values: {},
              view: { id: 'restored' },
            });
            const waiting = {
              phase: controller.phase,
              requested: controller.requested.time,
              presented: controller.presented.time,
              views: [...views],
            };
            release();
            await restoring;
            const result = { waiting, value: scene.snapshot().value, views };
            scene.dispose();
            return result;
          });
          assert.deepEqual(result, {
            waiting: { phase: 'preparing', requested: 4, presented: 0, views: [] },
            value: 4,
            views: ['restored'],
          });
        },
      );
      await t.test(
        'another chapter supplies its bounds before compatibility is decided',
        async () => {
          const result = await page.evaluate(async () => {
            lab.scene.dispose();
            let limit = 2,
              selected = [];
            const controller = API.story({
              script: {
                duration: 10,
                cues: { first: { start: 0, end: 5 }, second: { start: 5, end: 10 } },
                segments: [
                  { id: 'first', title: 'First', text: 'First', start: 0, end: 5 },
                  { id: 'second', title: 'Second', text: 'Second', start: 5, end: 10 },
                ],
              },
              stateAt: () => ({ amount: 1 }),
              render(_values, frame) {
                limit = frame.time < 5 ? 2 : 10;
              },
            });
            const scene = API.mountScene(
              document.querySelector('main'),
              {
                snapshot: () => controller.presented.state,
                review: controller.review,
                ready: controller.ready,
                pause: controller.pause,
                seek: controller.seek,
                duration: 10,
                get currentTime() {
                  return controller.currentTime;
                },
                get rendering() {
                  return {
                    phase: controller.phase,
                    requested: controller.requested,
                    presented: controller.presented,
                  };
                },
                dispose: controller.dispose,
              },
              {
                values: () => controller.requested.values,
                mode: () => controller.requested.mode,
                get parameters() {
                  return [
                    {
                      key: 'amount',
                      label: 'Amount',
                      value: 1,
                      min: 0,
                      max: limit,
                      disabled: true,
                    },
                  ];
                },
                setValues: (values) => controller.input(values),
                restoreValues: (values, position) => controller.restoreInputs(values, position),
              },
            );
            const saved = {
              time: 8,
              progress: 0.6,
              chapter: 'second',
              mode: 'explore',
              values: { amount: 8 },
            };
            const restored = await scene.restore(saved);
            let controlError;
            try {
              await scene.control([{ type: 'parameters', values: { amount: 9 } }]);
            } catch (error) {
              controlError = error.message;
            }
            const incompatible = await scene.restore({ ...saved, values: { amount: 11 } });
            const result = {
              value: restored.snapshot.amount,
              notices: restored.restoreNotices,
              limit,
              controlError,
              incompatible: incompatible.restoreNotices.map((n) => ({ code: n.code, ids: n.ids })),
              fallback: scene.snapshot().amount,
            };
            scene.dispose();
            return result;
          });
          assert.equal(result.value, 8);
          assert.equal(result.limit, 10);
          assert.deepEqual(result.notices, []);
          assert.match(result.controlError, /Invalid scene parameter/);
          assert.deepEqual(result.incompatible, [{ code: 'parameters-changed', ids: ['amount'] }]);
          assert.equal(result.fallback, 1);
        },
      );
    } finally {
      await browser.close();
    }
  },
);

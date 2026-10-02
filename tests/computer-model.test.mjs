import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  machine,
  snapshot,
  finish,
  NandModel,
  DisplayModel,
  ImageJob,
} from './support/computer.mjs';
import { makeScene, rootNode } from '../examples/computer-explorer/scenes.js';
import { CpuCycle } from '../examples/computer-explorer/cpu/model.js';

test('NAND erase respects physical block and drive boundaries', () => {
  const model = new NandModel();
  const sata = { drive: 'sata', chip: 0, die: 0, plane: 0, block: 0, row: 0, col: 0 };
  const nvme = { ...sata, drive: 'nvme' };
  for (const address of [sata, { ...sata, row: 3, col: 7 }, { ...sata, block: 1 }, nvme])
    model.program(address);
  model.erase(sata);
  assert.equal(model.bit(sata), 1);
  assert.equal(model.bit({ ...sata, row: 3, col: 7 }), 1);
  assert.equal(model.bit({ ...sata, block: 1 }), 0);
  assert.equal(model.bit(nvme), 0);
  const restored = new NandModel();
  restored.restore(model.snapshot());
  assert.deepEqual(restored.snapshot(), model.snapshot());
  restored.restore({ version: 1, blocks: { n0000: 'fffffffe', n9999: '00000000', s0000: 'bad' } });
  assert.deepEqual(restored.blocks, { n0000: 'fffffffe' });
});

test('LCD latches a transferred line and preserves charge through polarity and backlight changes', () => {
  const model = new DisplayModel();
  const initial = [...model.panel];
  [17, 34, 51].forEach((value, channel) => model.write(1, 2, channel, value));
  assert.deepEqual([...model.panel], initial);
  model.step();
  assert.equal(model.phase, 'loaded');
  assert.deepEqual([...model.panel], initial);
  model.step();
  assert(model.gateOpen(0));
  assert(!model.gateOpen(1));
  model.step();
  model.step();
  model.write(1, 2, 0, 99);
  model.step();
  assert.deepEqual(model.rgb(1, 2), [17, 34, 51]);
  model.step();
  assert(!model.gateOpen(1));
  model.refresh();
  assert.deepEqual([...model.panel], [...model.vram]);
  const picture = [...model.panel],
    polarities = [...model.polarities];
  model.refresh();
  assert.deepEqual([...model.panel], picture);
  assert(model.polarities.every((value, i) => value === -polarities[i]));
  model.backlight = false;
  assert.equal(model.color(1, 2), 'rgb(0 0 0)');
  assert.deepEqual([...model.panel], picture);
  const restored = new DisplayModel();
  restored.restore(model.snapshot());
  assert.deepEqual(restored.snapshot(), model.snapshot());
});

test('CPU commits one result at the clock edge for every four-bit addition', () => {
  for (let a = 0; a < 16; a++)
    for (let b = 0; b < 16; b++) {
      const model = new CpuCycle();
      model.restore({ a, b });
      assert.equal(model.sum, (a + b) & 15);
      assert.equal(model.carry, (a + b) >> 4);
      model.advance(model.period - 0.01);
      assert.equal(model.r1, a);
      assert.equal(model.cycles, 0);
      model.advance(model.period);
      model.advance(model.period);
      assert.equal(model.r1, (a + b) & 15);
      assert.equal(model.cycles, 1);
      const restored = new CpuCycle();
      restored.restore(model.snapshot());
      assert.equal(restored.r1, model.r1);
      model.begin();
      assert.equal(model.a, (a + b) & 15);
      assert.equal(model.cycles, 1);
    }
});

for (const architecture of ['discrete', 'unified']) {
  test(
    architecture + ': physical bytes survive every pipeline checkpoint and reach the LCD',
    () => {
      const m = machine(architecture),
        source = m.job.source,
        panel = [...m.display.panel],
        seen = new Set();
      const addresses = new Set(
        Array.from({ length: 32 }, (_, i) => {
          const n = m.job.physical(i);
          return m.nand.key(n) + ':' + n.row;
        }),
      );
      assert.equal(addresses.size, 32);
      let count = 0;
      while (!m.job.done && count++ < 1200) {
        const key = [m.job.phase, m.job.cpu.phase, m.job.gpu.phase, m.display.phase].join('/');
        if (!seen.has(key)) {
          seen.add(key);
          const state = snapshot(architecture, m),
            restored = machine(architecture, state);
          assert.deepEqual(restored.job.snapshot(), state.imageJob);
          finish(restored);
          assert.equal(restored.job.cpu.instructions, 224);
        }
        m.job.step();
        if (!['scanout', 'done'].includes(m.job.phase))
          assert.deepEqual([...m.display.panel], panel);
      }
      assert.equal(m.job.cpu.instructions, 224);
      assert.equal(m.job.gpu.written, 32);
      assert.equal(m.job.copied, architecture === 'unified' ? 0 : 32);
      assert.equal(m.job.gpuInput === m.job.ram, architecture === 'unified');
      for (let i = 0; i < 32; i++) {
        const v = Math.min(255, source[i] + 16);
        assert.equal(m.job.ram[i], v);
        for (let y = 0; y < 3; y++)
          for (let x = 0; x < 3; x++)
            assert.deepEqual(
              [...m.display.rgb(Math.floor(i / 8) * 3 + y, (i % 8) * 3 + x)],
              [v, Math.floor((v * 3) / 4), 255 - v],
            );
      }
      assert.deepEqual([...m.display.panel], [...m.display.vram]);
    },
  );
  test(architecture + ': every hardware drill-down has a body and finite unique targets', () => {
    const queue = [rootNode],
      seen = new Set();
    while (queue.length) {
      const node = queue.shift(),
        key = JSON.stringify({ ...node, label: undefined });
      if (seen.has(key)) continue;
      seen.add(key);
      for (const w of [352, 736]) {
        const scene = makeScene(
          node,
          { w, h: 460 },
          { gate: true, charge: true, romPower: true, light: true },
          new CpuCycle(),
          new DisplayModel(),
          architecture,
          new NandModel(),
        );
        assert(scene.body.length, node.type);
        assert.equal(new Set(scene.hits.map((h) => h.key)).size, scene.hits.length);
        for (const hit of scene.hits) assert(Object.values(hit.box).every(Number.isFinite));
        if (architecture === 'unified')
          assert(
            !/VRAM|GDDR/.test(scene.body + scene.caption + JSON.stringify(scene.hits)),
            node.type,
          );
        if (w === 736) queue.push(...scene.hits.map((h) => h.node));
      }
    }
    assert(seen.size > 9000);
  });
}
test('a pending DMA owns its read buffer; new reads observe physical NAND edits', () => {
  const m = machine('discrete');
  while (m.job.phase !== 'dma') m.job.step();
  m.nand.erase(m.job.physical(0));
  m.job.step();
  assert.equal(m.job.ram[0], 16);
  m.job.restart();
  while (m.job.phase !== 'complete') m.job.step();
  assert.equal(m.job.ram[0], 255);
  const nand = new NandModel();
  nand.program({ drive: 'nvme', chip: 1, col: 0 });
  const before = nand.snapshot();
  new ImageJob(nand, new DisplayModel(), () => 'discrete').start();
  assert.deepEqual(nand.snapshot(), before);
});

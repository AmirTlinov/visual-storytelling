import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { authorBenchmark } from './plugin/author-benchmark.mjs';

test(
  'benchmark binds pixels to the new task and rejects forged finish data and reused output',
  { timeout: 45000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'author-benchmark-'));
    const options = {
      release: new URL('../.plugin-release/', import.meta.url).pathname,
      output: join(temporary, 'run'),
      model: 'instrumentation-test',
      reasoning: 'none',
    };
    const runner = await authorBenchmark(options);
    t.after(async () => {
      await runner.close();
      await rm(temporary, { recursive: true, force: true });
    });
    const send = async (body) => {
      const r = await fetch(runner.endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-benchmark-token': runner.endpoint.token },
        body: JSON.stringify(body),
      });
      return { status: r.status, value: await r.json() };
    };
    const ready = (await send({ action: 'ready' })).value;
    assert(
      JSON.stringify(ready.tools.find((x) => x.name === 'story_edit')).includes('set-chapters'),
    );
    const brief = (await send({ action: 'start' })).value;
    assert.equal((await send({ action: 'observe', label: 'first' })).status, 500);
    const [count, divisor] = [
      Number(brief.task.match(/^\d+/)[0]),
      Number(brief.task.match(/по (\d+)/)[1]),
    ];
    const created = await send({
      action: 'call',
      name: 'story_create',
      arguments: {
        context: brief.context,
        title: 'Разложим предметы по группам',
        document: { recipe: 'division', inputs: { count, divisor } },
        requestId: randomUUID(),
      },
    });
    assert(!created.value.isError, JSON.stringify(created.value));
    const first = await send({ action: 'observe', label: 'first' });
    assert.equal(first.status, 200, JSON.stringify(first.value));
    assert.equal((await send({ action: 'observe', label: 'first' })).status, 500);
    const finished = await send({
      action: 'finish',
      capturedAt: -1,
      interactionAt: -1,
      observations: { initial: { count: 777 }, changed: { count: 888 } },
      authored: { models: [{ inputs: { count: 777 } }] },
    });
    assert.equal(finished.value.timingPassed, false);
    assert(finished.value.firstUsefulPixelMs >= 0);
    const report = JSON.parse(await readFile(join(options.output, 'trial-0.json'), 'utf8'));
    assert.equal(report.authored.models[0].inputs.count, count);
    assert.equal(report.observations.initial, undefined);
    assert.equal(report.observations.first.count, count);
    await send({ action: 'start' });
    await runner.close();
    const abandoned = JSON.parse(await readFile(join(options.output, 'trial-1.json'), 'utf8'));
    assert.match(abandoned.error, /closed before/);
    assert.equal(abandoned.timingPassed, false);
    await assert.rejects(authorBenchmark(options), { code: 'EEXIST' });
  },
);

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execute = promisify(execFile);
const higgsModule = new URL('../tools/voice/higgs.mjs', import.meta.url).href;

test('Linux Higgs discovery and synthesis reject before invoking an explicitly configured speech executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-linux-higgs-'));
  try {
    const command = join(directory, 'voice'),
      marker = join(directory, 'invoked');
    await writeFile(command, `#!/bin/sh\nprintf invoked > '${marker}'\nexit 19\n`, { mode: 0o755 });
    for (const arch of ['x64', 'arm64'])
      await execute(process.execPath, [
        '--input-type=module',
        '-e',
        `
        import assert from 'node:assert/strict';
        import {higgsVoice} from ${JSON.stringify(higgsModule)};
        Object.defineProperty(process,'platform',{value:'linux'});
        Object.defineProperty(process,'arch',{value:process.argv[2]});
        process.env.SKETCH_AUDIO_BIN=process.argv[1];
        const status=await higgsVoice.doctor();
        assert.equal(status.supported,false);assert.equal(status.ready,false);
        assert.match(status.reason,/MLX.*macOS Apple Silicon/);
        assert.equal(status.voices[0].id,'higgs');
        await assert.rejects(higgsVoice.prepare({language:'ru-RU'}),/MLX.*macOS Apple Silicon/);
        await assert.rejects(higgsVoice.build({file:'unused'},'unused'),/MLX.*macOS Apple Silicon/);
      `,
        command,
        arch,
      ]);
    assert.equal(
      await access(marker).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

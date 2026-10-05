import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** The core build owns its optional native speech executable and its receipt. */
export async function buildSystemVoice(output) {
  if (process.platform !== 'darwin') return;
  await mkdir(join(output, 'voice'), { recursive: true });
  await promisify(execFile)('xcrun', [
    'swiftc',
    '-O',
    '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos13.0`,
    fileURLToPath(new URL('macos.swift', import.meta.url)),
    '-o',
    join(output, 'voice/macos'),
  ]);
}

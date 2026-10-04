import { readdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';

function editAudioTags(html, edit) {
  const edits = [];
  const visit = (node) => {
    if (node.tagName === 'audio') {
      edit(node.sourceCodeLocation, edits);
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  for (const change of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, change.start) + change.text + html.slice(change.end);
  return html;
}

/** Change actual audio tags without touching scripts, styles or quoted examples. */
export function setNarrationMode(html, silent) {
  return editAudioTags(html, (location, edits) => {
    const attribute = location?.attrs?.['data-silent'];
    if (attribute)
      edits.push({
        start: attribute.startOffset,
        end: attribute.endOffset,
        text: silent ? 'data-silent="true"' : '',
      });
    else if (silent && location?.startTag) {
      const end =
        location.startTag.endOffset - (html[location.startTag.endOffset - 2] === '/' ? 2 : 1);
      edits.push({ start: end, end, text: ' data-silent="true"' });
    }
  });
}

/** A permanent silent template keeps story cues and authored credits, without speech scaffolding. */
export async function silenceSceneCopy(directory) {
  await promisify(execFile)('python3', [
    fileURLToPath(new URL('audio/silent.py', import.meta.url)),
    directory,
  ]);
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.html')) continue;
    const file = join(directory, name);
    const html = await readFile(file, 'utf8');
    await writeFile(
      file,
      editAudioTags(html, (location, edits) => {
        if (location)
          edits.push({ start: location.startOffset, end: location.endOffset, text: '' });
      }),
    );
  }
}

/** The same cached synthesis/alignment route for audio, scaffolding and delivery. */
export async function buildNarration(directory, { signal } = {}) {
  signal?.throwIfAborted();
  await new Promise((resolve, reject) => {
    const child = spawn(
      fileURLToPath(new URL('sketch-audio', import.meta.url)),
      ['build', join(directory, 'narration.json'), '--out', directory],
      { signal, stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Narration build failed (exit ${code})`)),
    );
  });
  for (const name of await readdir(directory)) {
    signal?.throwIfAborted();
    if (!name.endsWith('.html')) continue;
    const file = join(directory, name),
      html = await readFile(file, 'utf8');
    const audible = setNarrationMode(html, false);
    if (audible !== html) await writeFile(file, audible);
  }
}

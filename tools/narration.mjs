import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrationSource } from './story-document.mjs';
import { parse } from 'parse5';
import { macosVoice, systemNarration, voiceDigest } from './voice/macos.mjs';

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

/** The viewer needs semantic timing, not a synthesis receipt or local voice paths. */
export function playbackTimeline(timeline) {
  const fields = (value, keys) =>
    Object.fromEntries(
      keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]),
    );
  return {
    ...fields(timeline, ['version', 'duration', 'cues', 'captionAliases']),
    ...(timeline.segments && {
      segments: timeline.segments.map((segment) => ({
        ...fields(segment, ['id', 'title', 'text', 'start', 'end']),
        ...(segment.words && {
          words: segment.words.map((word) => fields(word, ['text', 'start', 'end'])),
        }),
      })),
    }),
  };
}

/** A permanent silent template keeps story cues and authored credits, without speech scaffolding. */
export async function silenceSceneCopy(directory) {
  const optional = (name) =>
    readFile(join(directory, name), 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  const story = await optional('story.json');
  if (story) {
    const document = JSON.parse(story);
    (document.narration ??= {}).enabled = false;
    await writeFile(join(directory, 'story.json'), JSON.stringify(document, null, 2) + '\n');
  }
  const original = await optional('timeline.json');
  const timeline = original && JSON.parse(original);
  if (timeline)
    await writeFile(
      join(directory, 'timeline.json'),
      JSON.stringify(playbackTimeline(timeline), null, 2) + '\n',
    );
  const credits = await optional('CREDITS.txt');
  if (credits) {
    let authored = credits
      .replace(
        /^=== visual-story:audio ===\r?\n[\s\S]*?^=== \/visual-story:audio ===(?:\r?\n|$)/gm,
        '',
      )
      .replaceAll(
        "This audio was created with Boson AI's Higgs Audio — https://www.boson.ai/higgs-audio\n",
        '',
      );
    const music = timeline?.mix?.music;
    if (music)
      authored = authored.replaceAll(
        `${music.title} — ${music.artist}\n${music.source}\n${music.license} ${music.license_url ?? ''}\n${music.changes}\n`,
        '',
      );
    if (authored.trim()) await writeFile(join(directory, 'CREDITS.txt'), authored.trim() + '\n');
    else await rm(join(directory, 'CREDITS.txt'));
  }
  for (const name of [
    'narration.json',
    'narration.txt',
    'voice-preview.html',
    'audio.wav',
    'voice.wav',
    'music.wav',
    'voice.json',
  ])
    await rm(join(directory, name), { force: true });
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
export async function buildNarration(directory, { signal, progress, cache } = {}) {
  signal?.throwIfAborted();
  const source = await narrationSource(directory);
  if (!source) throw new Error('Provide story.json or narration.json for speech');
  const settingsFile = join(directory, 'voice.json');
  let settings = await readFile(settingsFile, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const hasHiggs = Boolean(pkg.bin?.['sketch-audio']);
  const provider = settings?.provider ?? (hasHiggs ? 'higgs' : 'macos');
  let result;
  if (provider === 'macos') {
    if (settings?.provider !== 'macos' || settings?.enabled !== true || !settings?.voice) {
      const voice = await macosVoice.prepare(settings ?? {}, { signal });
      settings = {
        ...settings,
        enabled: true,
        provider,
        voice: voice.id,
        language: voice.language,
        rate: voice.rate,
      };
      signal?.throwIfAborted();
      await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n');
    }
    result = await systemNarration(directory, source.file, settings, { signal, progress, cache });
  } else if (provider === 'higgs') {
    if (!hasHiggs)
      throw new Error(
        'This package does not include Higgs. Choose provider "macos" in voice.json, or use the full repository with your licensed local Higgs installation.',
      );
    await new Promise((resolve, reject) => {
      const child = spawn(
        fileURLToPath(new URL('sketch-audio', import.meta.url)),
        ['build', source.file, '--source-directory', source.directory, '--out', directory],
        { signal, stdio: 'inherit' },
      );
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`Narration build failed (exit ${code})`)),
      );
    });
  } else
    throw new Error(
      `Unknown narration provider: ${provider}. Choose "macos"${hasHiggs ? ' or "higgs"' : ''} in voice.json.`,
    );
  for (const name of await readdir(directory)) {
    signal?.throwIfAborted();
    if (!name.endsWith('.html')) continue;
    const file = join(directory, name),
      html = await readFile(file, 'utf8');
    const audible = setNarrationMode(html, false);
    if (audible !== html) await writeFile(file, audible);
  }
  return result;
}

const root = fileURLToPath(new URL('../', import.meta.url));
export async function checkNarration(html, directory, { signal } = {}) {
  signal?.throwIfAborted();
  const audioFiles = new Set();
  const local = (url, base = directory) => {
    if (typeof url !== 'string') return;
    url = url.trim();
    if (!url || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(url)) return;
    const path = decodeURIComponent(url.split(/[?#]/)[0]);
    return path.startsWith('/') ? resolve(directory, '.' + path) : resolve(base, path);
  };
  function visit(node) {
    if (node.tagName === 'audio') {
      const attrs = Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
      if (attrs['data-silent'] === 'true') return;
      const urls =
        attrs.src || attrs['data-src']
          ? [attrs.src || attrs['data-src']]
          : (node.childNodes ?? [])
              .filter((child) => child.tagName === 'source')
              .map((child) => child.attrs.find(({ name }) => name === 'src')?.value);
      for (const url of urls) {
        const path = local(url);
        if (path) audioFiles.add(path);
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  if (!audioFiles.size) return;
  const script = await narrationSource(directory);
  if (!script) return;
  for (const audio of audioFiles) {
    let matched = false;
    // Receipts may live beside the audio or at the authored scene root.
    for (const folder of new Set([dirname(audio), directory])) {
      const timeline = resolve(folder, 'timeline.json');
      let receipt;
      try {
        receipt = JSON.parse(await readFile(timeline, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (local(receipt.audio, folder) !== audio) continue;
      matched = true;
      if (!receipt.source_sha256)
        throw new Error('Generated narration has no source receipt. Run visual-story audio.');
      if (receipt.digest_format === 'canonical-json-v1') {
        if (
          receipt.source_sha256 !== voiceDigest(JSON.parse(await readFile(script.file, 'utf8'))) ||
          voiceDigest(receipt.voice_settings) !==
            voiceDigest(JSON.parse(await readFile(join(directory, 'voice.json'), 'utf8')))
        )
          throw new Error(
            'Narration or voice changed. Prepare the current narration before building.',
          );
        break;
      }
      try {
        await promisify(execFile)(
          'python3',
          [
            resolve(root, 'tools/audio/cli.py'),
            'check',
            script.file,
            '--source-directory',
            script.directory,
            '--timeline',
            timeline,
          ],
          { signal, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } },
        );
      } catch (error) {
        if (error.code === 'ENOENT')
          throw new Error('Checking generated narration requires python3 (standard library only).');
        throw new Error(`${timeline}: ${error.stderr?.trim() || error.message}`);
      }
      break;
    }
    if (!matched)
      throw new Error(
        `Generated narration has no matching timeline for ${audio}. Run visual-story audio.`,
      );
  }
}

/** Reuse the receipt check and speech cache before an audible development rebuild. */
export async function prepareNarration(directory, { audible = false, signal } = {}) {
  let rebuilt = false;
  for (const name of await readdir(directory)) {
    signal?.throwIfAborted();
    if (!name.endsWith('.html')) continue;
    const file = join(directory, name);
    let html = await readFile(file, 'utf8');
    try {
      await checkNarration(audible ? setNarrationMode(html, false) : html, directory, { signal });
    } catch (error) {
      signal?.throwIfAborted();
      if (rebuilt || !(await narrationSource(directory))) throw error;
      await buildNarration(directory, { signal });
      rebuilt = true;
      html = await readFile(file, 'utf8');
      await checkNarration(html, directory, { signal });
    }
    const next = audible ? setNarrationMode(html, false) : html;
    if (next !== html) await writeFile(file, next);
  }
}

import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { narrationSource } from './story-document.mjs';
import { parse } from 'parse5';
import { higgsVoice } from './voice/higgs.mjs';
import { narrationProvider } from './voice/settings.mjs';
import { recoverNarration, assertNarrationPublished } from './voice/publication.mjs';

function editAudioTags(html, edit) {
  const edits = [];
  const visit = (node) => {
    if (node.tagName === 'audio') {
      edit(node.sourceCodeLocation, edits, node);
    }
    for (const child of node.childNodes ?? []) visit(child);
    // Template contents are inert examples, never the scene's live media hook.
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  for (const change of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, change.start) + change.text + html.slice(change.end);
  return html;
}

/** Change actual audio tags without touching scripts, styles or quoted examples. */
export function setNarrationMode(html, silent, { preparedClock } = {}) {
  let found = false;
  const prepared = editAudioTags(html, (location, edits, node) => {
    found = true;
    const clock = location?.attrs?.['data-story-preview'];
    if (clock && preparedClock !== undefined)
      edits.push({
        start: clock.startOffset,
        end: clock.endOffset,
        text: preparedClock ? 'data-story-preview="true"' : '',
      });
    else if (preparedClock && location?.startTag) {
      const end =
        location.startTag.endOffset - (html[location.startTag.endOffset - 2] === '/' ? 2 : 1);
      edits.push({ start: end, end, text: ' data-story-preview="true"' });
    }
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
    if (
      !silent &&
      !node.attrs.some(({ name }) => name === 'data-story-timeline') &&
      location?.startTag
    ) {
      const end =
        location.startTag.endOffset - (html[location.startTag.endOffset - 2] === '/' ? 2 : 1);
      edits.push({ start: end, end, text: ' data-story-timeline="timeline.json"' });
    }
  });
  if (!silent && !found) {
    const audio = `<audio data-story-audio data-story-timeline="timeline.json" src="audio.wav" preload="auto"${preparedClock ? ' data-story-preview="true"' : ''}></audio>`;
    // Source documents may begin as quiet lessons without an audio element.
    const body = parse(html, { sourceCodeLocationInfo: true })
      .childNodes.find((node) => node.tagName === 'html')
      ?.childNodes.find((node) => node.tagName === 'body');
    // Packed scene scripts may execute while the parser is still in the body.
    // Publish media before them so the scene mounts with its actual clock.
    const start = body?.sourceCodeLocation?.startTag?.endOffset ?? 0;
    return prepared.slice(0, start) + audio + prepared.slice(start);
  }
  if (!silent) {
    const hooks = [];
    const withoutHooks = editAudioTags(prepared, (location, edits, node) => {
      if (!location || !node.attrs.some(({ name }) => name === 'data-story-audio')) return;
      hooks.push(prepared.slice(location.startOffset, location.endOffset));
      edits.push({ start: location.startOffset, end: location.endOffset, text: '' });
    });
    if (hooks.length) {
      const body = parse(withoutHooks, { sourceCodeLocationInfo: true })
        .childNodes.find((node) => node.tagName === 'html')
        ?.childNodes.find((node) => node.tagName === 'body');
      const start = body?.sourceCodeLocation?.startTag?.endOffset ?? 0;
      return withoutHooks.slice(0, start) + hooks.join('') + withoutHooks.slice(start);
    }
  }
  return prepared;
}

/** Deliver quiet media hooks without their recording, preserving the authored source. */
export function playbackHTML(html, { silent = false } = {}) {
  if (silent) html = setNarrationMode(html, true);
  return editAudioTags(html, (location, edits, node) => {
    if (!node.attrs.some(({ name, value }) => name === 'data-silent' && value === 'true')) return;
    for (const name of ['src', 'data-src']) {
      const span = location?.attrs?.[name];
      if (span) edits.push({ start: span.startOffset, end: span.endOffset, text: '' });
    }
    for (const child of node.childNodes ?? [])
      if (child.tagName === 'source' && child.sourceCodeLocation)
        edits.push({
          start: child.sourceCodeLocation.startOffset,
          end: child.sourceCodeLocation.endOffset,
          text: '',
        });
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
        // The audio span includes pauses that authored chapter and motion windows use.
        ...fields(segment, [
          'id',
          'title',
          'text',
          'displayText',
          'start',
          'end',
          'audio_start',
          'audio_end',
          'conditions',
          'source_text',
          'seed',
          'source_seed',
          'delivery',
        ]),
        ...(segment.words && {
          words: segment.words.map((word) => fields(word, ['text', 'start', 'end'])),
        }),
      })),
    }),
  };
}

/** Defer synthesis without changing the editable speech, timing or selected provider. */
export async function deferNarration(directory) {
  const names = await readdir(directory);
  if (names.some((name) => ['voice.json', 'story.json'].includes(name))) {
    const file = join(directory, 'voice.json');
    const settings = names.includes('voice.json') ? JSON.parse(await readFile(file, 'utf8')) : {};
    if (settings.enabled !== false)
      await writeFile(file, JSON.stringify({ ...settings, enabled: false }, null, 2) + '\n');
  }
  for (const name of names) {
    if (!name.endsWith('.html')) continue;
    const file = join(directory, name),
      html = await readFile(file, 'utf8'),
      silent = setNarrationMode(html, true);
    if (silent !== html) await writeFile(file, silent);
  }
}

/** A permanent silent template keeps story cues and authored credits, without speech scaffolding. */
export async function silenceSceneCopy(directory) {
  await deferNarration(directory);
  const read = (name) =>
    readFile(join(directory, name), 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  const write = (name, value) =>
    writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
  const timing = await read('timeline.json');
  if (timing) {
    const timeline = JSON.parse(timing);
    const script = Object.fromEntries(
      ['version', 'duration', 'segments', 'cues', 'captionAliases']
        .filter((key) => Object.hasOwn(timeline, key))
        .map((key) => [key, timeline[key]]),
    );
    for (const segment of script.segments ?? [])
      for (const key of ['seed', 'delivery']) delete segment[key];
    await write('timeline.json', script);
  }
  const credits = await read('CREDITS.txt');
  if (credits !== undefined) {
    // Only the explicit audio-owned block can be removed; every other attribution is authored.
    const authored = credits
      .replace(
        /^=== visual-story:audio ===\r?\n[\s\S]*?^=== \/visual-story:audio ===(?:\r?\n|$)/gm,
        '',
      )
      .trim();
    if (authored) await writeFile(join(directory, 'CREDITS.txt'), authored + '\n');
    else await rm(join(directory, 'CREDITS.txt'));
  }
  for (const name of [
    'narration.json',
    'narration.txt',
    'voice-preview.html',
    'audio.wav',
    'voice.wav',
    'music.wav',
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
export async function buildNarration(
  directory,
  { signal, progress, cache, managedProcessGroup = false, sourcePrepared } = {},
) {
  signal?.throwIfAborted();
  await recoverNarration(directory);
  const source = await narrationSource(directory);
  if (!source)
    throw new Error('Provide story.json for speech; narration.json is a derived voice job.');
  // Explicit preparation freezes IDs/dependencies for CLI and plugin consumers alike.
  await writeFile(join(directory, 'story.json'), JSON.stringify(source.document, null, 2) + '\n');
  const settingsFile = join(directory, 'voice.json');
  let settings = await readFile(settingsFile, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const provider = narrationProvider(settings);
  settings = { ...settings, enabled: true, provider };
  await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  for (const name of await readdir(directory)) {
    signal?.throwIfAborted();
    if (!name.endsWith('.html')) continue;
    const file = join(directory, name),
      html = await readFile(file, 'utf8');
    const audible = setNarrationMode(html, false);
    if (audible !== html) await writeFile(file, audible);
  }
  // The job owner checkpoints frozen authored inputs before a model can spend work.
  await sourcePrepared?.();
  let result;
  if (provider === 'higgs') {
    higgsVoice.validate(settings ?? {});
    if (!(await higgsVoice.reuse(source, directory, { signal }))) {
      await higgsVoice.prepare(settings ?? {}, { signal });
      await higgsVoice.build(source, directory, { signal, progress });
    }
    signal?.throwIfAborted();
  } else {
    const { buildAdapterNarration } = await import('./voice/adapter.mjs');
    result = await buildAdapterNarration(directory, source.file, settings, {
      signal,
      progress,
      cache,
      managedProcessGroup,
    });
    signal?.throwIfAborted();
  }
  return result;
}

export async function checkNarration(html, directory, { signal, preview } = {}) {
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
  // The read-only preview owner has verified this exact waveform against an accepted source.
  if (preview?.playable) audioFiles.delete(resolve(directory, 'audio.wav'));
  if (!audioFiles.size) return;
  await assertNarrationPublished(directory);
  const script = await narrationSource(directory);
  if (!script) return;
  const settings = await readFile(join(directory, 'voice.json'), 'utf8').then(
    JSON.parse,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
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
      if (receipt.segments?.some((unit) => unit.displayText !== undefined))
        throw new Error('Accepted narration cannot contain a derived pending caption.');
      if (!receipt.source_sha256)
        throw new Error('Generated narration has no source receipt. Run visual-story audio.');
      const selected = narrationProvider(settings);
      const provider = receipt.synthesis?.provider ?? 'higgs';
      if (provider !== selected)
        throw new Error('Narration provider changed. Prepare the selected voice before building.');
      if (selected !== 'higgs') {
        const { checkAdapterNarration } = await import('./voice/adapter.mjs');
        await checkAdapterNarration(directory, script, receipt, settings, audio);
        break;
      }
      try {
        await higgsVoice.check(script, timeline, { signal });
      } catch (error) {
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

/** Read-only final gate. Preparing a voice is a separate explicit action. */
export async function requireNarration(directory, { signal, silent = false } = {}) {
  signal?.throwIfAborted();
  const settings = await readFile(join(directory, 'voice.json'), 'utf8').then(
    JSON.parse,
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  if (silent || settings?.enabled === false) return { silent: true };
  if (settings?.enabled !== true) return { silent: false };
  await checkNarration('<audio data-story-audio src="audio.wav"></audio>', directory, { signal });
  return { silent: false };
}

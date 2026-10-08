import { readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { narrationSource } from './story-document.mjs';
import { parse } from 'parse5';
import { macosVoice, systemNarration, voiceDigest } from './voice/macos.mjs';
import { higgsVoice } from './voice/higgs.mjs';

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
  let found = false;
  const prepared = editAudioTags(html, (location, edits) => {
    found = true;
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
  if (!silent && !found) {
    const audio = '<audio data-story-audio src="audio.wav" preload="auto"></audio>';
    // Source documents may begin as quiet lessons without an audio element.
    const body = parse(html, { sourceCodeLocationInfo: true })
      .childNodes.find((node) => node.tagName === 'html')
      ?.childNodes.find((node) => node.tagName === 'body');
    const end = body?.sourceCodeLocation?.endTag?.startOffset ?? prepared.length;
    return prepared.slice(0, end) + audio + prepared.slice(end);
  }
  return prepared;
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
        ...fields(segment, ['id', 'title', 'text', 'start', 'end', 'audio_start', 'audio_end']),
        ...(segment.words && {
          words: segment.words.map((word) => fields(word, ['text', 'start', 'end'])),
        }),
      })),
    }),
  };
}

/** A permanent silent template keeps story cues and authored credits, without speech scaffolding. */
export async function silenceSceneCopy(directory) {
  const read = (name) =>
    readFile(join(directory, name), 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  const write = (name, value) =>
    writeFile(join(directory, name), JSON.stringify(value, null, 2) + '\n');
  const story = await read('story.json');
  if (story) {
    const document = JSON.parse(story);
    (document.narration ??= {}).enabled = false;
    await write('story.json', document);
  }
  const voice = await read('voice.json');
  if (voice) await write('voice.json', { ...JSON.parse(voice), enabled: false });
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
export async function buildNarration(directory, { signal, progress, cache } = {}) {
  signal?.throwIfAborted();
  const source = await narrationSource(directory);
  if (!source) throw new Error('Provide story.json or narration.json for speech');
  const settingsFile = join(directory, 'voice.json');
  let settings = await readFile(settingsFile, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  const provider = settings?.provider ?? 'higgs';
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
    await higgsVoice.prepare(settings ?? {}, { signal });
    await higgsVoice.build(source, directory, { signal, progress });
    signal?.throwIfAborted();
    settings = { ...settings, enabled: true, provider };
    await writeFile(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  } else
    throw new Error(
      `Unknown narration provider: ${provider}. Choose "higgs" or explicitly "macos" in voice.json.`,
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
      if (!receipt.source_sha256)
        throw new Error('Generated narration has no source receipt. Run visual-story audio.');
      const provider =
        receipt.synthesis?.provider ??
        (receipt.digest_format === 'canonical-json-v1' ? 'macos' : 'higgs');
      if (provider !== (settings?.provider ?? 'higgs'))
        throw new Error('Narration provider changed. Prepare the selected voice before building.');
      if (receipt.digest_format === 'canonical-json-v1') {
        const authored = JSON.parse(await readFile(script.file, 'utf8'));
        if (
          receipt.source_sha256 !== voiceDigest(authored) ||
          voiceDigest(receipt.voice_settings) !== voiceDigest(settings)
        )
          throw new Error(
            'Narration or voice changed. Prepare the current narration before building.',
          );
        for (const segment of authored.segments ?? [])
          for (const cue of segment.cues ?? [])
            if (
              !receipt.cues?.[cue.id] ||
              voiceDigest({ timing: cue.timing }) !==
                voiceDigest({ timing: receipt.cues[cue.id].timing })
            )
              throw new Error(
                `Narration action timing is stale for ${cue.id}. Prepare the current narration before building.`,
              );
        const { cueSheet } = await import('../dist/story/cues.js');
        cueSheet(receipt);
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

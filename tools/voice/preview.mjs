import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJSON } from '../storage.mjs';
import { narrationSource } from '../story-document.mjs';
import { checkNarration } from '../narration.mjs';
import { resolvePackage } from '../build-info.mjs';
import { readStoryProject } from '../story-project.mjs';
import { adapterInput, adapterSelection } from './adapter-input.mjs';
import { narrationProvider } from './settings.mjs';
import { voiceDigest, voiceBytesDigest } from './receipt.mjs';

const audioHook = '<audio data-story-audio src="audio.wav"></audio>';

async function selection(directory, document, settings) {
  const provider = narrationProvider(settings);
  const { enabled: _enabled, ...sound } = settings;
  const voice = document.narration?.voice ?? { seed: 42 };
  return voiceDigest({
    settings: provider === 'higgs' ? sound : adapterSelection(settings),
    voice,
    reference: voice.reference_audio
      ? voiceBytesDigest(await readFile(resolve(directory, voice.reference_audio)))
      : undefined,
    adapter: provider === 'higgs' ? undefined : (await adapterInput(directory, settings)).identity,
  });
}

/** Read-only preview. Only a verified current/accepted recording may lend ready whole takes. */
export async function narrationPreview(directory, { acceptedDirectory, signal } = {}) {
  signal?.throwIfAborted();
  const settings = await readJSON(join(directory, 'voice.json'));
  if (settings?.enabled !== true) return { playable: false, status: { enabled: false } };
  const source = await narrationSource(directory);
  if (!source) throw new Error('Provide story.json before enabling narration.');
  const runtime = await resolvePackage('@visual-storytelling/core', directory);
  const api = await import(
    runtime
      ? pathToFileURL(join(runtime, 'dist/story/document.js')).href
      : new URL('../../dist/story/document.js', import.meta.url).href
  );
  if (typeof api.documentSpeechPreparation !== 'function')
    throw new Error('Migrate this project runtime explicitly before using narration previews.');
  let recording,
    current = false;
  try {
    await checkNarration(audioHook, directory, { signal });
    recording = await readJSON(join(directory, 'timeline.json'));
    current = true;
  } catch {
    signal?.throwIfAborted();
    if (acceptedDirectory) {
      // A changed source is not authority to bless a different waveform or selected provider.
      try {
        await checkNarration(audioHook, acceptedDirectory, { signal });
        const previous = await narrationSource(acceptedDirectory);
        const previousSettings = await readJSON(join(acceptedDirectory, 'voice.json'));
        const [oldSelection, newSelection, oldAudio, newAudio, oldTimeline, newTimeline] =
          await Promise.all([
            selection(acceptedDirectory, previous.document, previousSettings),
            selection(directory, source.document, settings),
            readFile(join(acceptedDirectory, 'audio.wav')),
            readFile(join(directory, 'audio.wav')),
            readJSON(join(acceptedDirectory, 'timeline.json')),
            readJSON(join(directory, 'timeline.json')),
          ]);
        if (
          oldSelection === newSelection &&
          voiceBytesDigest(oldAudio) === voiceBytesDigest(newAudio) &&
          voiceDigest(oldTimeline) === voiceDigest(newTimeline)
        ) {
          // Arbitrary authored modules conservatively need explicit preparation after a change.
          const manifest = await readStoryProject(directory);
          if (manifest && !manifest.modules.length) {
            if (
              voiceDigest(source.spec.segments.map((unit) => unit.id)) !==
              voiceDigest(newTimeline.segments?.map((unit) => unit.id))
            )
              throw new Error('The accepted speech structure changed.');
            api.documentScript(source.document, newTimeline);
            recording = newTimeline;
          }
        }
      } catch {
        signal?.throwIfAborted();
      }
    }
  }
  const units = api.documentSpeechPreparation(source.document, recording);
  const ready = units.filter((unit) => unit.status === 'ready').map((unit) => unit.id);
  const pending = units.filter((unit) => unit.status === 'pending');
  return {
    playable: ready.length > 0,
    partial: !current && ready.length > 0,
    displayText: Object.fromEntries(pending.map((unit) => [unit.id, unit.text])),
    status: {
      enabled: true,
      current,
      ready,
      pending: pending.map((unit) => unit.id),
      units,
      preparation: {
        units: pending.length,
        characters: pending.reduce((count, unit) => count + unit.text.length, 0),
        // Provider pricing and possible retries are unknown until explicitly configured.
        monetaryCost: null,
        assembly: !current,
      },
    },
  };
}

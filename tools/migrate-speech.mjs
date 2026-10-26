import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spokenText } from '../dist/story/spoken-words.js';
import { cueSheet } from '../dist/story/cues.js';
import { narrationSource } from './story-document.mjs';
import { narrationProvider } from './voice/settings.mjs';
import { higgsVoice } from './voice/higgs.mjs';

/** Explicit migration freezes each accepted whole take; it never cuts or regroups speech. */
export function bindAcceptedSpeech(source, recording) {
  cueSheet(recording);
  const document = structuredClone(source),
    used = new Set();
  for (const chapter of document.chapters)
    for (const beat of chapter.beats) {
      const text = beat.say ?? beat.text;
      if (!text?.trim()) continue;
      const cue = recording.cues[`${chapter.id}.${beat.id}`];
      const anchor = cue?.speech ?? cue;
      const matches = recording.segments?.filter(
        (unit) => anchor && anchor.start >= unit.start - 1e-6 && anchor.end <= unit.end + 1e-6,
      );
      if (matches?.length !== 1)
        throw new Error(
          `Cannot bind accepted speech to ${chapter.id}.${beat.id}; preserve the old pin and migrate its authored cues explicitly.`,
        );
      const unit = matches[0];
      if (unit.audio_start === undefined || unit.audio_end === undefined)
        throw new Error(`Accepted take ${unit.id} has no complete recording boundaries.`);
      beat.speech = {
        id: unit.id,
        when: unit.conditions ?? {
          basis: 'authored',
          models: document.models.map((model) => ({
            model: model.id,
            inputs: structuredClone(model.inputs),
          })),
        },
        ...((unit.source_seed ?? unit.seed) !== undefined && {
          seed: unit.source_seed ?? unit.seed,
        }),
        ...(unit.delivery !== undefined && { delivery: unit.delivery }),
      };
      used.add(unit.id);
    }
  for (const unit of recording.segments ?? []) {
    const text = document.chapters
      .flatMap((chapter) => chapter.beats)
      .filter((beat) => beat.speech?.id === unit.id)
      .map((beat) => beat.say ?? beat.text)
      .join(' ');
    if (
      !used.has(unit.id) ||
      spokenText(text) !== spokenText(unit.text) ||
      text.trim().replace(/\s+/g, ' ') !==
        (unit.source_text ?? unit.text).trim().replace(/\s+/g, ' ')
    )
      throw new Error(
        `Migration would change accepted whole take ${unit.id}; keep its original source and pin.`,
      );
  }
  return document;
}

const optional = async (file) =>
  readFile(file, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
  });

/** Verify the old root fingerprint before document/pin changes; only migration uses this path. */
export async function acceptedAdapterForMigration(directory) {
  const [settings, recording] = await Promise.all(
    ['voice.json', 'timeline.json'].map((name) => optional(join(directory, name))),
  );
  if (
    !settings ||
    settings.provider === 'higgs' ||
    settings.adapter?.includes('/') ||
    recording?.digest_format !== 'voice-adapter-v1'
  )
    return;
  const { adapterInput, historicalRootAdapterInput } = await import('./voice/adapter-input.mjs');
  const current = (await adapterInput(directory, settings)).identity,
    accepted = recording.synthesis?.adapter_sha256;
  if (
    current !== accepted &&
    (await historicalRootAdapterInput(directory, settings)).identity !== accepted
  )
    throw new Error(
      'The accepted root adapter changed; migration cannot synthesize a replacement.',
    );
  return { current, accepted };
}

/** Runs only on the migration snapshot, after its explicit runtime upgrade. */
export async function migrateAcceptedSpeech(directory, task = {}) {
  const [source, recording] = await Promise.all(
    ['story.json', 'timeline.json'].map((name) => optional(join(directory, name))),
  );
  if (!source || !recording?.audio) return [];
  const document = bindAcceptedSpeech(source, recording);
  const content = JSON.stringify(document, null, 2) + '\n';
  await writeFile(join(directory, 'story.json'), content);
  const projection = await narrationSource(directory);
  const settings = await optional(join(directory, 'voice.json'));
  if (narrationProvider(settings) === 'higgs')
    await higgsVoice.bindRecording(projection, join(directory, 'timeline.json'), task);
  else {
    const { bindAdapterRecording } = await import('./voice/adapter.mjs');
    await bindAdapterRecording(directory, projection.file, settings, task);
  }
  const changes = [
    { path: 'story.json', content },
    { path: 'timeline.json', content: await readFile(join(directory, 'timeline.json'), 'utf8') },
  ];
  const legacy = await optional(join(directory, 'narration.json'));
  if (legacy) {
    const accepted = recording.segments.map((unit) => [unit.id, spokenText(unit.text)]);
    if (
      JSON.stringify(legacy.segments?.map((unit) => [unit.id, spokenText(unit.text)])) !==
      JSON.stringify(accepted)
    )
      throw new Error(
        'narration.json contains unaccepted speech. Move that intent into story.json explicitly before migration.',
      );
    await rm(join(directory, 'narration.json'));
    changes.push({ path: 'narration.json', content: null });
  }
  return changes;
}

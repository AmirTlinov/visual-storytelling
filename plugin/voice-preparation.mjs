import { join } from 'node:path';
import { projectFiles } from '../tools/project-files.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { recoverNarration, narrationOutputNames } from '../tools/voice/publication.mjs';
import { buildNarration, requireNarration } from '../tools/narration.mjs';
import { narrationPreview } from '../tools/voice/preview.mjs';
import { narrationProvider } from '../tools/voice/settings.mjs';
import { prepareEnvironment } from '../tools/environment.mjs';

/** Recover only the explicit job's derived outputs; authored changes remain a hard failure. */
export async function recoverVoicePreparation(directory, receipt, task) {
  const baseline = receipt.voicePreparation?.files;
  if (!receipt.preparation?.voice || !baseline || receipt.preparedRevision) return;
  const owned = new Set(narrationOutputNames);
  const verify = (files) => {
    if (
      [...new Set([...Object.keys(baseline), ...Object.keys(files)])].some(
        (name) => !owned.has(name) && baseline[name] !== files[name],
      )
    )
      throw new Error(
        'Voice preparation authored inputs changed. Restore the captured inputs before retrying.',
      );
  };
  verify((await projectFiles(directory)).files);
  await recoverNarration(directory);
  const recovered = await projectFiles(directory);
  if (
    ['audio.wav', 'timeline.json', 'voice.wav', 'music.wav'].some(
      (name) => baseline[name] !== recovered.files[name],
    )
  )
    await requireNarration(directory, task);
  const checked = await projectFiles(directory);
  verify(checked.files);
  return checked.revision;
}

/** Explicit voice work has one checkpoint before spending provider work. */
export async function prepareProjectVoice(snapshot, data, acceptedRecording, task) {
  const plan = await narrationPreview(snapshot, {
    acceptedDirectory: acceptedRecording?.directory,
    signal: task.signal,
  });
  task.progress(
    `Подготовка голоса: ${plan.status.preparation.units} мыслей, ${plan.status.preparation.characters} символов; тариф провайдера не задан.`,
  );
  const voice = await readJSON(join(snapshot, 'voice.json'));
  await prepareEnvironment(data, {
    ...task,
    voice: narrationProvider(voice) === 'higgs',
    encoder: true,
  });
  await buildNarration(snapshot, {
    ...task,
    cache: join(data, 'speech'),
    managedProcessGroup: Boolean(task.jobId),
    sourcePrepared: async () => {
      const file = join(snapshot, '.vstory-input.json');
      const receipt = await readJSON(file);
      await writeJSON(file, { ...receipt, voicePreparation: await projectFiles(snapshot) });
    },
  });
}

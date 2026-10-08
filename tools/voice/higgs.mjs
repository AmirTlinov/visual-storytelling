import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { delimiter, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const available = (file, mode = constants.F_OK) =>
  access(file, mode).then(
    () => true,
    () => false,
  );

/** Read-only discovery: the plugin environment owner prepares Python and models. */
async function installation() {
  const cache =
    process.env.SKETCH_AUDIO_CACHE ??
    join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'sketch-visualization');
  const command =
    process.env.SKETCH_AUDIO_BIN ??
    process.env.SKETCH_AUDIO_PYTHON ??
    join(cache, 'venv/bin/python');
  if (!(await available(command, constants.X_OK)))
    throw new Error(
      'Голос ещё не подготовлен. Выберите Higgs в озвучке: плагин подготовит Python и модели с прогрессом и отменой.',
    );
  return {
    command,
    prefix: process.env.SKETCH_AUDIO_BIN
      ? []
      : [fileURLToPath(new URL('../../tools/audio/cli.py', import.meta.url))],
    env: {
      ...process.env,
      PATH: [
        ...new Set([process.env.PATH, dirname(command), '/opt/homebrew/bin'].filter(Boolean)),
      ].join(delimiter),
      PYTHONDONTWRITEBYTECODE: '1',
      TOKENIZERS_PARALLELISM: 'false',
    },
  };
}

// Inspection runs only an already prepared interpreter; it never invokes a package installer.
async function inspect(args, { signal } = {}) {
  const { command, prefix, env } = await installation();
  return execute(command, [...prefix, ...args], {
    signal,
    timeout: 15000,
    env,
  });
}

export const higgsVoice = {
  id: 'higgs',
  async doctor(task = {}) {
    try {
      const { stdout } = await inspect(['doctor'], task);
      const resources = JSON.parse(stdout);
      const ready = Boolean(
        resources.verified &&
          resources.speech_ready &&
          resources.reference_ready &&
          resources.aligner &&
          resources.ffmpeg,
      );
      return {
        ready,
        voices: [{ id: 'higgs', name: 'Higgs TTS 3', language: 'ru-RU' }],
        ...(!ready && {
          reason:
            'Подготовка Higgs загрузит около 12 ГБ: Python, модель речи и разметку слов. Нужно около 18 ГБ свободного места; рекомендуется 32 ГБ памяти.',
        }),
      };
    } catch (error) {
      task.signal?.throwIfAborted();
      return {
        ready: false,
        voices: [{ id: 'higgs', name: 'Higgs TTS 3', language: 'ru-RU' }],
        reason: error.stderr?.trim() || error.message,
      };
    }
  },
  async prepare(settings, task = {}) {
    if (settings.voice && settings.voice !== 'higgs')
      throw new Error(
        'Для системного голоса явно выберите provider: "macos". Голос Higgs задаётся образцом в narration.json.',
      );
    if (settings.language && settings.language.split('-')[0] !== 'ru')
      throw new Error('Локальный Higgs настроен на русскую речь и русское выравнивание слов.');
    const status = await this.doctor(task);
    if (!status.ready) throw new Error(status.reason);
  },
  async build(source, directory, { signal, progress = () => {} } = {}) {
    const { command, prefix, env } = await installation();
    progress('Готовлю нейросетевую озвучку Higgs TTS 3');
    await new Promise((resolve, reject) => {
      const child = spawn(
        command,
        [
          ...prefix,
          'build',
          source.file,
          '--source-directory',
          source.directory,
          '--out',
          directory,
        ],
        { signal, stdio: 'inherit', env },
      );
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `Higgs narration failed (exit ${code}). Системный голос автоматически не выбирается.`,
              ),
            ),
      );
    });
  },
  async check(source, timeline, task = {}) {
    await inspect(
      ['check', source.file, '--source-directory', source.directory, '--timeline', timeline],
      task,
    );
  },
};

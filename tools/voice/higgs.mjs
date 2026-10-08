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

/** Full-library and packaged callers share the user's installed Higgs tool, never a system fallback. */
async function installation() {
  const candidates = process.env.SKETCH_AUDIO_BIN
    ? [process.env.SKETCH_AUDIO_BIN]
    : [
        fileURLToPath(new URL('../../tools/sketch-audio', import.meta.url)),
        ...(process.env.PATH ?? '')
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, 'sketch-audio')),
        join(homedir(), '.local/bin/sketch-audio'),
      ];
  for (const command of candidates) {
    if (!(await available(command, constants.X_OK))) continue;
    const env = {
      ...process.env,
      PATH: [
        ...new Set(
          [
            process.env.PATH,
            dirname(command),
            join(homedir(), '.local/bin'),
            '/opt/homebrew/bin',
          ].filter(Boolean),
        ),
      ].join(delimiter),
      PYTHONDONTWRITEBYTECODE: '1',
    };
    return { command, env };
  }
  throw new Error(
    'Нейросетевая озвучка Higgs недоступна. Подключите локальный sketch-audio через PATH или SKETCH_AUDIO_BIN. Системный голос автоматически не выбирается.',
  );
}

// The wrapper owns its Python environment, including when Codex starts with a minimal GUI PATH.
async function inspect(args, { signal } = {}) {
  const { command, env } = await installation();
  return execute(command, args, {
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
            'Higgs требует подготовленных моделей, образца голоса и FFmpeg. Выполните sketch-audio setup в установленной полной библиотеке.',
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
    const { command, env } = await installation();
    progress('Готовлю нейросетевую озвучку Higgs TTS 3');
    await new Promise((resolve, reject) => {
      const child = spawn(
        command,
        ['build', source.file, '--source-directory', source.directory, '--out', directory],
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

/** Project voice.json selects one synthesis owner for CLI, jobs and MCP. */
export function narrationProvider(settings) {
  const provider = settings?.provider ?? 'higgs';
  if (!['higgs', 'local', 'api'].includes(provider))
    throw new Error(
      'Unsupported narration provider. Choose "higgs", a selected "local" model, or an "api" adapter in voice.json.',
    );
  return provider;
}

/** Inspection may encounter hand-edited invalid files; never echo arbitrary configuration. */
export function voiceSettingsForDisplay(settings) {
  if (!settings || typeof settings !== 'object') return undefined;
  return Object.fromEntries(
    ['provider', 'adapter', 'model', 'voice', 'language', 'enabled']
      .filter((key) => typeof settings[key] === (key === 'enabled' ? 'boolean' : 'string'))
      .map((key) => [key, settings[key]]),
  );
}

/** Preserve provider-specific settings only while the selected provider stays the same. */
export function selectVoiceSettings(previous, patch, defaultLanguage) {
  const { enabled, voice, model, adapter } = patch;
  const provider = patch.provider ?? previous?.provider ?? 'higgs';
  return {
    ...(previous?.provider === provider ? previous : {}),
    ...(enabled !== undefined && { enabled }),
    provider,
    language: patch.language ?? previous?.language ?? defaultLanguage,
    ...(voice !== undefined && { voice }),
    ...(model !== undefined && { model }),
    ...(adapter !== undefined && { adapter }),
  };
}

/** Higgs owns its model and reference voice; custom selection belongs to an adapter. */
export function validateHiggsSelection(settings, { enabled, voice, model, adapter }) {
  if (adapter !== undefined || model !== undefined)
    throw new Error('Для своей модели выберите provider: "local" или "api".');
  if (voice && voice !== 'higgs')
    throw new Error(
      'Голос Higgs задаётся образцом в narration.json; другую модель подключите как local или api.',
    );
  if (enabled && settings.language.split('-')[0] !== 'ru')
    throw new Error('Для Higgs сейчас поддерживается русская речь. Выберите ru-RU.');
}

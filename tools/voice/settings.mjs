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

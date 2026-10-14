import { join } from 'node:path';
import { readJSON } from '../tools/storage.mjs';
import { configureEnvironment, environmentStatus } from '../tools/environment.mjs';
import { higgsVoice } from '../tools/voice/higgs.mjs';
import { adapterVoiceStatus, validateAdapterSettings } from '../tools/voice/adapter-input.mjs';
import {
  narrationProvider,
  voiceSettingsForDisplay,
  selectVoiceSettings,
  validateHiggsSelection,
} from '../tools/voice/settings.mjs';
import { requireVoiceSupport } from '../tools/environment/voice.mjs';
import { storyDocumentAPI } from '../tools/runtime-package.mjs';
import { readStoryProject } from '../tools/story-project.mjs';

/** Adapt provider selection to project revisions; edit remains the sole mutation path. */
export function projectVoice({ data, preferences, projects, edit, prepareDocument }) {
  return async function voice({
    projectId,
    sourceRevision,
    requestId,
    enabled,
    provider,
    voice,
    language,
    model,
    adapter,
  }) {
    const defaults = await preferences.read();
    const previous = projectId
      ? await readJSON(join(projects.get(projectId).path, 'voice.json'))
      : undefined;
    const settings = selectVoiceSettings(
      previous,
      { enabled, provider, voice, language, model, adapter },
      defaults.language,
    );
    provider = settings.provider;
    const selectedLanguage = settings.language;
    const persist = async () => {
      const changes = [{ path: 'voice.json', content: JSON.stringify(settings, null, 2) + '\n' }];
      if (enabled) {
        const project = projects.get(projectId);
        const source = await readJSON(join(project.path, 'story.json'));
        if (!source) throw new Error('Provide an authored story.json before preparing voice.');
        const manifest = await readStoryProject(project.path);
        const document = manifest?.modules.length
          ? await prepareDocument({ project, sourceRevision, document: source })
          : (
              await storyDocumentAPI(project.path, {
                installedFrom: (
                  await readJSON(join(data, 'builds', project.buildRevision + '.json'))
                )?.snapshot,
              })
            ).validateStoryDocument(source);
        changes.push({
          path: 'story.json',
          content: JSON.stringify(document, null, 2) + '\n',
        });
      }
      return edit({
        projectId,
        sourceRevision,
        requestId,
        changes,
      });
    };
    // Turning speech off must remain possible when a selected backend is incomplete or removed.
    if (enabled === false) return persist();
    try {
      narrationProvider(settings);
    } catch (error) {
      if (enabled !== undefined) throw error;
      return {
        provider,
        supported: false,
        ready: false,
        reason: error.message,
        voices: [],
        settings: voiceSettingsForDisplay(previous),
      };
    }
    if (enabled && provider === 'higgs') requireVoiceSupport();
    if (enabled === undefined) {
      await configureEnvironment(data);
      const higgs = await higgsVoice.doctor();
      const environment = await environmentStatus(data);
      const choices = [
        { provider: 'higgs', kind: 'local', ...higgs },
        ...(await Promise.all(
          ['local', 'api'].map(async (id) => ({
            provider: id,
            kind: id,
            ...(id === provider && projectId
              ? await adapterVoiceStatus(projects.get(projectId).path, settings)
              : {
                  supported: true,
                  ready: false,
                  voices: [],
                  reason: 'Выберите модель и подключите её адаптер через агента.',
                }),
          })),
        )),
      ].map((status) => {
        const voices = status.voices.filter(
          (v) => v.language.split('-')[0] === selectedLanguage.split('-')[0],
        );
        return {
          ...status,
          ready: status.ready && voices.length > 0,
          reason:
            status.reason ??
            (voices.length
              ? undefined
              : `У провайдера ${status.provider} нет голоса для ${selectedLanguage}.`),
          voices,
        };
      });
      const status = choices.find((choice) => choice.provider === provider);
      return {
        provider,
        supported: status.supported,
        ready: status.ready,
        reason: status.reason,
        providers: choices,
        voices: choices.flatMap((choice) =>
          choice.voices.map((item) => ({
            ...item,
            provider: choice.provider,
            kind: choice.kind,
            ready: choice.ready,
            supported: choice.supported,
            reason: choice.reason,
          })),
        ),
        settings: voiceSettingsForDisplay(previous),
        ...(provider === 'higgs' && { requirements: environment.higgs.requirements }),
        ...(provider !== 'higgs' && {
          readiness: status.ready ? 'adapter-configured' : 'configuration-required',
          synthesisVerified: false,
        }),
      };
    }
    if (provider === 'higgs') {
      validateHiggsSelection(settings, { enabled, voice, model, adapter });
    } else {
      validateAdapterSettings(settings);
      if (enabled) {
        const status = await adapterVoiceStatus(projects.get(projectId).path, settings);
        if (!status.ready) throw new Error(status.reason);
      }
    }
    return persist();
  };
}

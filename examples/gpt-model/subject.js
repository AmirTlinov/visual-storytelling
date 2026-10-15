import { createGPTPresentation } from './presentation.js';
import { gptParameters } from './parameters.js';
import { PRESETS } from './model.js';
import { gptInputs } from './subject-model.js';
import { kindFor, perspectives, parentView } from './presentation/format.js';
function chapterTime(document, script, test) {
  const chapter = document.chapters.find(test);
  return chapter ? script.cues[chapter.id]?.start : undefined;
}
function predictionTime(document, script) {
  return chapterTime(document, script, (c) =>
    c.beats.some((b) => b.awaitInput?.model === document.models[0].id),
  );
}
function viewTime(document, script, view, checked) {
  if (view === 'output')
    return checked
      ? chapterTime(document, script, (c) => c.beats.some((b) => b.operation?.name === 'output'))
      : predictionTime(document, script);
  const chapter = chapterTime(document, script, (c) =>
    c.views?.some((id) => document.views.find((v) => v.id === id)?.kind === view),
  );
  return (
    chapter ??
    (view === 'overview' ? undefined : viewTime(document, script, parentView(view), checked))
  );
}
export default {
  title: 'Как GPT выбирает следующее слово',
  frame: { width: 1280, height: 720, scope: 'stage' },
  parameters: (model) => gptParameters(model.inputs),
  controls: ['preset', 'prompt', 'token', 'block', 'head'],
  resolveInput(patch, current, document, script, intent = 'input') {
    if (intent === 'restore') return { values: gptInputs({ ...current.values, ...patch }) };
    const p = { ...current.values, ...patch };
    if (patch.view !== undefined && patch.detailPage === undefined) p.detailPage = -1;
    if (patch.preset !== undefined || patch.prompt !== undefined) {
      p.token = patch.prompt ? 7 : PRESETS.find((item) => item.id === p.preset).tokens.length;
      p.source = 1;
      p.checked = false;
      p.guess = '';
      p.generated = false;
      if (patch.preset !== undefined) p.prompt = '';
    }
    if (patch.ablate !== undefined) {
      p.checked = false;
      p.guess = '';
    }
    if (patch.token !== undefined || patch.generated !== undefined) p.guess = '';
    p.kind = kindFor(p.view, p.kind);
    if (!perspectives(p.view).includes(p.perspective)) {
      if (patch.perspective !== undefined)
        throw Error(`View ${p.view} supports: ${perspectives(p.view).join(', ')}.`);
      p.perspective = 'diagram';
    }
    let time = current.time;
    if (patch.checked === true) time = viewTime(document, script, 'output', true) ?? time;
    else if (patch.view !== undefined) time = viewTime(document, script, p.view, p.checked) ?? time;
    else if ((patch.preset !== undefined || patch.prompt !== undefined) && p.view === 'output')
      time = predictionTime(document, script) ?? time;
    return { values: gptInputs(p), time };
  },
  resolveTime(values, authored) {
    return gptInputs({
      ...values,
      view: authored.view,
      perspective: authored.perspective,
      kind: authored.kind,
      phase: authored.phase,
      detailPage: -1,
    });
  },
  create(viewport) {
    if (!viewport.input || !viewport.attachView)
      throw Error('This interactive GPT drawing needs the shared input and view owners.');
    const presentation = createGPTPresentation(viewport);
    return {
      validate(_model, _views, values) {
        gptInputs(values);
      },
      prepare(_model, _views, state, _beat, moment, signal) {
        return presentation.prepare(state.detail, moment?.frame, signal);
      },
      ready: presentation.ready,
      render(model, views, state, _beat, moment) {
        presentation.render(state.detail, moment?.frame, moment?.mode ?? 'explore', {
          modelId: model.id,
          view: views[0],
        });
      },
      snapshot(state) {
        const s = state.detail;
        return {
          ...s.values,
          token: s.token,
          source: s.source,
          trace: s.trace,
          candidate: s.candidate,
        };
      },
      dispose: presentation.dispose,
    };
  },
};

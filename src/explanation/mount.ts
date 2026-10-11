import { SceneShell } from '../scene.js';
import { surface } from '../ink/surface.js';
import { story, type Story } from '../story/story.js';
import type { Frame, Script } from '../story/cues.js';
import { divisionState, type DivisionState } from '../math/division.js';
import { divisionDiagram } from '../recipes/division.js';
import { validateExplanation, type ExplanationDocument, type ExplanationBeat } from './document.js';

type Inputs = { count: number; divisor: number };
let surfaceSerial = 0;
const standardScore: ExplanationBeat[] = [
  { id: 'gather', action: 'gather', seconds: 1.2 },
  { id: 'group', action: 'group', seconds: 4 },
  { id: 'remainder', action: 'remainder', seconds: 2.8, focus: ['remainder'] },
];

/** This score describes attention and actions; Story remains the only clock. */
export function explanationScript(document: ExplanationDocument): Script {
  let cursor = 0;
  const cues = Object.fromEntries(
    (document.score ?? standardScore).map((beat) => {
      const start = cursor;
      cursor += beat.seconds ?? (beat.action === 'group' ? 4 : 2);
      return [
        beat.id,
        {
          start,
          end: cursor,
          ...(beat.hold
            ? { hold: 'Observe the current relationship' }
            : { action: beat.action ?? 'Focus on the subject' }),
          ...(beat.text ? { text: beat.text } : {}),
        },
      ];
    }),
  );
  return { duration: cursor, cues };
}

function pose(document: ExplanationDocument, frame: Frame) {
  let progress = 0;
  let current: ExplanationBeat | undefined;
  for (const beat of document.score ?? standardScore) {
    if (frame.time < frame.cue(beat.id).start) break;
    current = beat;
    if (beat.action === 'gather') progress = 0;
    if (beat.action === 'group') progress = frame.reveal(beat.id);
    if (beat.action === 'remainder') progress = 1;
    for (const view of document.views) frame.target(beat.id, view.id);
  }
  return { progress, text: current?.text, focus: current?.focus ?? ('all' as const) };
}

/** Compile a short explanation into the same shell, controls, history, transport and scene handle. */
export async function mountExplanation(root: HTMLElement, source: unknown) {
  let document = validateExplanation(source);
  await SceneShell.ready();
  const shell = SceneShell.mount(root, {
    title: document.title ?? 'Остаток от деления',
    heading: document.title !== undefined,
    parameters: [
      {
        key: 'count',
        label: 'Предметов',
        type: 'stepper',
        value: document.model.count,
        min: 0,
        max: 36,
        step: 1,
      },
      {
        key: 'divisor',
        label: 'В группе',
        type: 'stepper',
        value: document.model.divisor,
        min: 1,
        max: 12,
        step: 1,
      },
    ],
  });
  const drawing = surface(shell.stage, {
    id: `explanation-${++surfaceSerial}`,
    title: document.title ?? 'Деление на полные группы и остаток',
    description: 'Меняйте количество предметов или размер группы и проверяйте результат.',
    width: shell.layout.width,
    height: shell.layout.height,
    grid: false,
  });
  const diagram = divisionDiagram(drawing, document.model.id);
  shell.onDispose(diagram.dispose);
  shell.onDispose(drawing.dispose);
  let controller: Story<Inputs, string, DivisionState>;
  const handle = root.scene!;

  function prepare(source: unknown, provisional = false, authoredInputs: readonly string[] = []) {
    const next = validateExplanation(source);
    if (
      !Array.isArray(authoredInputs) ||
      authoredInputs.some((key) => !['count', 'divisor'].includes(key))
    )
      throw new Error('authoredInputs: choose count or divisor.');
    if (!provisional && next.model.id !== document.model.id)
      throw new Error('model.id: retain the subject identity while editing this explanation.');
    const previous = controller?.presented;
    // A view/score edit retains the viewer's experiment. Explicitly changed authored
    // conditions replace only those fields, leaving the other chosen condition intact.
    const values = {
      count:
        previous && !authoredInputs.includes('count') && next.model.count === document.model.count
          ? previous.values.count
          : next.model.count,
      divisor:
        previous &&
        !authoredInputs.includes('divisor') &&
        next.model.divisor === document.model.divisor
          ? previous.values.divisor
          : next.model.divisor,
    };
    const layout = shell.layout;
    const state = divisionState(values.count, values.divisor, { id: next.model.id });
    // Check every caption before publishing the score: a later seek must not discover
    // an invalid layout in a document which the authoring owner already accepted.
    for (const text of new Set((next.score ?? standardScore).map((beat) => beat.text))) {
      diagram.validate(state, {
        width: layout.width,
        height: layout.height,
        scale: layout.scale,
        progress: 1,
        showEquation: next.views.some((view) => view.kind === 'equation'),
        text,
        viewIds: {
          groups: next.views.find((view) => view.kind === 'groups')!.id,
          equation: next.views.find((view) => view.kind === 'equation')?.id,
        },
      });
    }
    return { next, values, previous };
  }

  async function replace(
    source: unknown,
    {
      signal,
      provisional = false,
      authoredInputs,
    }: {
      signal?: AbortSignal;
      provisional?: boolean;
      authoredInputs?: readonly string[];
    } = {},
  ) {
    signal?.throwIfAborted();
    const { next, values, previous } = prepare(source, provisional, authoredInputs);
    const script = explanationScript(next);
    let active = false;
    let prepared: { state: DivisionState; frame: Frame } | undefined;
    const render = (state: DivisionState, frame: Frame) => {
      const layout = shell.layout;
      drawing.resize(layout.width, layout.height, false);
      diagram.render(state, {
        width: layout.width,
        height: layout.height,
        scale: layout.scale,
        ...pose(next, frame),
        showEquation: next.views.some((view) => view.kind === 'equation'),
        viewIds: {
          groups: next.views.find((view) => view.kind === 'groups')!.id,
          equation: next.views.find((view) => view.kind === 'equation')?.id,
        },
      });
    };
    const candidate = story<Inputs, string, DivisionState>({
      script,
      exploreTimeline: true,
      stateAt: () => ({ count: next.model.count, divisor: next.model.divisor }),
      derive(values) {
        // One validation path applies equally to authored changes, viewer input and replay.
        const validated = validateExplanation({ ...next, model: { ...next.model, ...values } });
        return divisionState(validated.model.count, validated.model.divisor, { id: next.model.id });
      },
      resolveInput(patch, current) {
        const values = { ...current.values, ...patch };
        const group = (next.score ?? standardScore).find((beat) => beat.action === 'group');
        return { values, time: group ? script.cues[group.id]!.end : current.time };
      },
      render(state, frame) {
        if (active) render(state, frame);
        else prepared = { state, frame };
      },
    });
    try {
      if (previous)
        candidate.restoreInputs(values, {
          time: Math.min(previous.time, script.duration),
          mode: previous.mode,
        });
      await candidate.ready();
      signal?.throwIfAborted();
      if (!prepared) throw new Error('Explanation has no prepared model frame.');
      // All model and layout decisions are validated by the recipe before its DOM commit.
      render(prepared.state, prepared.frame);
      shell.attachController(candidate);
      controller = candidate;
      document = next;
      active = true;
      shell.setTitle(next.title ?? 'Остаток от деления', { visible: next.title !== undefined });
      drawing.element.querySelector('title')!.textContent =
        next.title ?? 'Деление на полные группы и остаток';
    } catch (error) {
      candidate.dispose();
      throw error;
    }
  }
  await replace(document);
  handle.extend({
    authoring: {
      get document() {
        return structuredClone(document);
      },
      validate(source: unknown, options) {
        prepare(source, false, options?.authoredInputs);
      },
      replace,
    },
  });
  return handle;
}

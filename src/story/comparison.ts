import type { ModelValues, ModelState, StoryModel, StoryModelModule } from './model.js';
export interface ComparedModel {
  readonly id: string;
  readonly module: string;
  readonly inputs: ModelValues;
  readonly state: ModelState;
}
export interface ModelComparison {
  readonly before: ComparedModel;
  readonly after: ComparedModel;
  readonly changes: readonly {
    key: string;
    before: ModelValues[string];
    after: ModelValues[string];
  }[];
  readonly controlled: readonly string[];
}
/** Both cases use one domain owner and differ only in explicitly selected inputs. */
export function compareModelSnapshots(
  owner: StoryModelModule,
  model: StoryModel,
  changes: ModelValues,
): ModelComparison {
  const baseline = Object.freeze({ ...owner.validateInputs({ ...model.inputs }) });
  for (const key of Object.keys(changes))
    if (!Object.hasOwn(baseline, key)) throw new Error(`Unknown comparison input: ${key}`);
  const variant = Object.freeze({ ...owner.validateInputs({ ...baseline, ...changes }) });
  if (
    Object.keys(variant).length !== Object.keys(baseline).length ||
    Object.keys(variant).some((key) => !Object.hasOwn(baseline, key))
  )
    throw new Error('Comparison cases need the same input dimensions.');
  const changed = Object.keys(baseline).filter((key) => !Object.is(baseline[key], variant[key]));
  if (changed.some((key) => !Object.hasOwn(changes, key)))
    throw new Error('Comparison validation changed an uncontrolled input.');
  const snapshot = (side: 'before' | 'after', inputs: ModelValues): ComparedModel => {
    const scoped = Object.freeze({ ...model, id: `${model.id}:${side}`, inputs });
    return Object.freeze({
      id: scoped.id,
      module: scoped.module,
      inputs: Object.freeze({ ...inputs }),
      state: structuredClone((owner.staticState ?? owner.state).call(owner, inputs, scoped)),
    });
  };
  return Object.freeze({
    before: snapshot('before', baseline),
    after: snapshot('after', variant),
    changes: Object.freeze(
      changed.map((key) => Object.freeze({ key, before: baseline[key]!, after: variant[key]! })),
    ),
    controlled: Object.freeze(Object.keys(baseline).filter((key) => !changed.includes(key))),
  });
}

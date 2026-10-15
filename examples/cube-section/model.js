/** Exact intersection of [-1,1]^3 with the plane z=constant. */
export function cubeSection(z) {
  if (!Number.isFinite(z) || Math.abs(z) > 1.2) throw Error('Choose z in [-1.2,1.2].');
  const vertices =
    Math.abs(z) <= 1
      ? [
          [-1, -1, z],
          [1, -1, z],
          [1, 1, z],
          [-1, 1, z],
        ]
      : [];
  return { z, vertices, area: vertices.length ? 4 : 0 };
}
const validateInputs = (input) => {
  if (!input || Object.keys(input).length !== 1 || typeof input.offset !== 'number')
    throw Error('cube.inputs: provide offset.');
  cubeSection(input.offset);
  return { offset: input.offset };
};
const compute = (inputs, progress) => ({
  ...validateInputs(inputs),
  progress,
  section: cubeSection(progress === 1 ? inputs.offset : 1.2 + (inputs.offset - 1.2) * progress),
});
export const cubeModel = {
  validateInputs,
  state: (inputs) => compute(inputs, 0),
  staticState: (inputs) => compute(inputs, 1),
  experimentState: (inputs) => compute(inputs, 1),
  operations: {
    approach: (state, progress) => compute({ offset: state.offset }, progress),
    finish: (state) => compute({ offset: state.offset }, 1),
  },
  validateViews(views) {
    if (views.length !== 1 || views[0].kind !== 'cube-cut') throw Error('Use one cube-cut view.');
  },
  focusTargets: () => ['cube:whole', 'cube:section'],
};

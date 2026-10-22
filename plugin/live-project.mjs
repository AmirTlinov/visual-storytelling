import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureWorkingInput } from './revision-input.mjs';
import { digest } from '../tools/project-files.mjs';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { explanationAPI, assertPreparedExplanation } from '../tools/runtime-package.mjs';

/** Prepared components and immutable authored inputs are one ordinary project build. */
export async function prepareLiveProject(data, project) {
  const input = await captureWorkingInput(data, project, project.sourceRevision);
  const snapshot = join(data, 'snapshots', input.inputSnapshot);
  const pin = await assertPreparedExplanation(snapshot);
  const { validateExplanation } = await explanationAPI(snapshot);
  const document = validateExplanation(await readJSON(join(snapshot, 'explanation.json')));
  const template = await readFile(join(pin.root, 'plugin/dist/live.html'), 'utf8');
  const setup = `<script>window.__visualStoryExplanation=${JSON.stringify(document).replaceAll('<', '\\u003c')}</script>`;
  const html = template.replace('</head>', () => setup + '</head>');
  const revision = digest(
    JSON.stringify({
      projectId: project.id,
      sourceRevision: project.sourceRevision,
      runtime: pin.build,
      html,
    }),
  );
  const prepared = {
    projectId: project.id,
    title: project.title,
    revision,
    sourceRevision: project.sourceRevision,
    snapshot,
    html,
    live: { runtimeBuild: pin.build, document },
  };
  await writeJSON(join(data, 'builds', revision + '.json'), prepared);
  const receipt = await readJSON(join(snapshot, '.vstory-input.json'));
  await writeJSON(join(snapshot, '.vstory-input.json'), { ...receipt, buildRevision: revision });
  return prepared;
}

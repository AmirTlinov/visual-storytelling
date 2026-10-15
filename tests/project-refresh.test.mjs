import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../plugin/projects.mjs';
import { writePreparedBuild } from '../plugin/build-payload.mjs';
import { refreshProject } from '../plugin/runtime/project-refresh.mjs';

test('a delayed file event follows authored delivery instead of rebuilding its accepted revision', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-refresh-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'project'),
    data = join(directory, 'data');
  await mkdir(path);
  await writeFile(join(path, 'scene.js'), 'first');
  const projects = new ProjectStore(data),
    project = await projects.register(path);
  const sessions = {
    sessions: new Map([
      ['card', { build: { projectId: project.id, sourceRevision: project.sourceRevision } }],
    ]),
  };
  let prepared = 0,
    release;
  const options = {
    data,
    projects,
    sessions,
    jobs: { list: () => [] },
    isUpdating: () => false,
    prepareProject: async (value) => {
      prepared++;
      assert.notEqual(value.sourceRevision, project.sourceRevision);
    },
  };
  const editing = projects.serial('delivery:' + project.id, async () => {
    await new Promise((resolve) => (release = resolve));
    await writeFile(join(path, 'scene.js'), 'authored');
    const current = await projects.inspect(project.id);
    await writePreparedBuild(data, {
      revision: 'accepted',
      projectId: project.id,
      sourceRevision: current.sourceRevision,
      html: '<main>authored</main>',
    });
    await projects.update(project.id, { buildRevision: 'accepted' });
  });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  const event = refreshProject(options, project.id);
  release();
  await Promise.all([editing, event]);
  assert.equal(
    prepared,
    0,
    'the prepared current revision owns delivery even before its frame ACK',
  );
  await writeFile(join(path, 'scene.js'), 'external');
  await refreshProject(options, project.id);
  assert.equal(prepared, 1);
  await refreshProject(
    {
      ...options,
      jobs: { list: () => [{ kind: 'build', status: 'running', sourceRevision: undefined }] },
    },
    project.id,
  );
  assert.equal(prepared, 2, 'a build for another revision does not mask an external change');
  const current = await projects.inspect(project.id);
  await refreshProject(
    {
      ...options,
      jobs: {
        list: () => [{ kind: 'build', status: 'running', sourceRevision: current.sourceRevision }],
      },
    },
    project.id,
  );
  assert.equal(prepared, 2, 'an existing current build is not duplicated');
});

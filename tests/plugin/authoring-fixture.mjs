import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(JSON.stringify(result));
  return result.structuredContent;
}

/** Exercise public authoring with a small private subject, without adding it to the catalog. */
export async function createProjectFixture(client, { title, path }, fixture = 'scene-shell') {
  const created = await call(client, 'story_create', { title, path, requestId: randomUUID() });
  if (created.authoring !== 'ready') await finishFixtureJob(client, created.job.id);
  const project = await call(client, 'story_inspect', { projectId: created.project.id });
  const directory = new URL(`../fixtures/${fixture}/`, import.meta.url);
  const changes = await Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter(
        (entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'README.md',
      )
      .map(async ({ name }) => ({
        path: name,
        content: await readFile(new URL(name, directory), 'utf8'),
      })),
  );
  return call(client, 'story_edit', {
    context: project.context,
    requestId: randomUUID(),
    changes,
  });
}

export async function finishFixtureJob(client, jobId) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const job = await call(client, 'story_inspect', { jobId, waitMs: 15000 });
    if (job.status === 'succeeded') return job;
    if (['failed', 'cancelled', 'interrupted'].includes(job.status))
      throw new Error(JSON.stringify(job));
  }
  throw new Error(`Fixture build deadline: ${jobId}`);
}

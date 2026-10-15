import { readBuildMetadata } from '../build-payload.mjs';

/** Filesystem events reconcile after authored delivery, against the accepted build owner. */
export function refreshProject({ data, projects, sessions, jobs, prepareProject, isUpdating }, id) {
  return projects.serial('delivery:' + id, async () => {
    if (isUpdating()) return;
    const project = await projects.inspect(id);
    const prepared = await readBuildMetadata(data, project.buildRevision);
    if (prepared?.projectId === id && prepared.sourceRevision === project.sourceRevision) return;
    if (
      jobs
        .list(id)
        .some(
          (job) =>
            ['build', 'create'].includes(job.kind) &&
            job.sourceRevision === project.sourceRevision &&
            ['queued', 'running'].includes(job.status),
        )
    )
      return;
    const displayed = [...sessions.sessions.values()].filter(
      (session) => session.build.projectId === id,
    );
    if (
      displayed.some(
        (session) =>
          session.build.sourceRevision !== project.sourceRevision &&
          session.nextBuild?.sourceRevision !== project.sourceRevision,
      )
    )
      await prepareProject(project);
  });
}

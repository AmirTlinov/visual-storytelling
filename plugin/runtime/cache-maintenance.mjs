import { collectCache } from '../cache.mjs';

/** Coalesce authored bursts; JobRunner still serializes collection with captures and worker starts. */
export function runtimeCache({ data, preferences, projects, sessions, jobs }) {
  let report = null,
    timer,
    firstRequest;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    firstRequest = undefined;
  };
  const collect = () => {
    cancel();
    jobs.requestMaintenance(async () => {
      const started = performance.now();
      const projectSnapshot = await projects.cacheSnapshot();
      const result = await collectCache(data, {
        limitMB: (await preferences.read()).cacheLimitMB,
        projects: projectSnapshot.projects,
        sessions: [...sessions.sessions.values()],
        snapshotLeases: jobs.snapshotLeases(),
        buildLeases: [...sessions.buildLeases(), ...projectSnapshot.buildLeases],
      });
      report = {
        ...result,
        collectedAt: new Date().toISOString(),
        elapsedMs: performance.now() - started,
      };
    });
  };
  return {
    get report() {
      return report && { ...report, scheduled: timer !== undefined };
    },
    schedule({ immediate = false } = {}) {
      if (immediate) {
        collect();
        return;
      }
      firstRequest ??= performance.now();
      clearTimeout(timer);
      // Frequent edits need one collection after settling, and cannot postpone it forever.
      timer = setTimeout(
        collect,
        Math.max(0, Math.min(250, 5000 - (performance.now() - firstRequest))),
      );
      timer.unref();
    },
    cancel,
  };
}

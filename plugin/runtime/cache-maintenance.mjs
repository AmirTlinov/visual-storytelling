import { collectCache } from '../cache.mjs';

/** JobRunner serializes collection with captures and worker starts; owners provide leases. */
export function runtimeCache({ data, preferences, projects, sessions, jobs }) {
  let report = null;
  return {
    get report() {
      return report;
    },
    schedule() {
      jobs.requestMaintenance(async () => {
        const projectSnapshot = await projects.cacheSnapshot();
        const result = await collectCache(data, {
          limitMB: (await preferences.read()).cacheLimitMB,
          projects: projectSnapshot.projects,
          sessions: [...sessions.sessions.values()],
          snapshotLeases: jobs.snapshotLeases(),
          buildLeases: [...sessions.buildLeases(), ...projectSnapshot.buildLeases],
        });
        report = { ...result, collectedAt: new Date().toISOString() };
      });
    },
  };
}

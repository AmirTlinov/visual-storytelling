import { watch as watchFiles } from 'node:fs';
import { sceneInput } from '../tools/assets.mjs';

/** Observe editor writes; unknown events and observer failures require content reconciliation. */
export class ProjectWatch {
  entries = new Map();
  constructor(changed, { watch = watchFiles, debounce = 400, retry = 1000 } = {}) {
    Object.assign(this, { changed, watch, debounce, retry });
  }
  open(project) {
    const previous = this.entries.get(project.id);
    if (previous?.path === project.path) return;
    if (previous) this.stop(previous);
    const entry = {
      path: project.path,
      paths: new Set(),
      full: true,
      running: false,
      retryDelay: this.retry,
    };
    this.entries.set(project.id, entry);
    const active = () => this.entries.get(project.id) === entry;
    const schedule = (delay = this.debounce) => {
      if (!active()) return;
      clearTimeout(entry.timer);
      entry.timer = setTimeout(notify, delay);
    };
    const notify = async () => {
      if (!active() || entry.running || (!entry.full && !entry.paths.size)) return;
      const change = { full: entry.full, paths: [...entry.paths].sort() };
      entry.paths.clear();
      entry.full = false;
      entry.running = true;
      let failed = false;
      try {
        await this.changed(project.id, change);
      } catch (error) {
        console.error(`Project reconciliation: ${error.message}`);
        entry.full = failed = true;
        for (const path of change.paths) entry.paths.add(path);
      } finally {
        entry.running = false;
        if (entry.full || entry.paths.size) schedule(failed ? entry.retryDelay : this.debounce);
      }
    };
    const failedWatch = (error) => {
      if (!active()) return;
      console.error(`Project watcher: ${error.message}`);
      entry.watcher?.close();
      entry.watcher = undefined;
      entry.full = true;
      schedule();
      clearTimeout(entry.retryTimer);
      entry.retryTimer = setTimeout(connect, entry.retryDelay);
      entry.retryDelay = Math.min(entry.retryDelay * 2, 30000);
    };
    const connect = () => {
      if (!active() || entry.watcher) return;
      try {
        const watcher = this.watch(project.path, { recursive: true }, (event, file) => {
          if (!active() || entry.watcher !== watcher) return;
          const path = file == null ? undefined : String(file);
          if (path && (!sceneInput(path) || path === 'story.vstory')) return;
          if (path) entry.paths.add(path);
          if (!path || event !== 'change') entry.full = true;
          entry.retryDelay = this.retry;
          schedule();
        });
        entry.watcher = watcher;
        watcher.on('error', (error) => {
          if (entry.watcher === watcher) failedWatch(error);
        });
        // Cover the interval before opening/reopening the filesystem observer.
        entry.full = true;
        schedule();
      } catch (error) {
        failedWatch(error);
      }
    };
    connect();
  }
  stop(entry) {
    clearTimeout(entry.timer);
    clearTimeout(entry.retryTimer);
    entry.watcher?.close();
  }
  close() {
    for (const entry of this.entries.values()) this.stop(entry);
    this.entries.clear();
  }
}

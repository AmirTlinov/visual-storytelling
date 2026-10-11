import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  realpath,
  readdir,
  stat,
  copyFile,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { projectFiles, projectFile, readProjectFile, digest } from '../tools/project-files.mjs';
import { failure } from './errors.mjs';
import { sceneEntry } from '../tools/scene-entry.mjs';
import { explanationAPI, assertPreparedExplanation } from '../tools/runtime-package.mjs';

const readOptional = (file) =>
  readFile(file).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
const matches = (bytes, text) =>
  text === null ? bytes === null : bytes !== null && bytes.equals(Buffer.from(text));
const conflict = (name) =>
  new Error(`Interrupted edit conflicts with ${name}. Resolve it using .vstory/transaction.json.`);
const validRequest = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);
const validCursor = (id) => id === null || validRequest(id);

/** Validate the same bounded UTF-8 authoring changes for a working edit or migration candidate. */
export async function prepareProjectChanges(root, changes) {
  if (
    !changes?.length ||
    changes.length > 64 ||
    new Set(changes.map((c) => c.path)).size !== changes.length
  )
    throw new Error('Supply 1–64 distinct authored files.');
  const edits = [];
  for (const change of changes) {
    const file = await projectFile(root, change.path, { writable: true });
    const bytes = await readOptional(file);
    if (
      bytes &&
      (bytes.length > 1_000_000 ||
        bytes.includes(0) ||
        !Buffer.from(bytes.toString('utf8')).equals(bytes))
    )
      throw new Error(`Use ordinary file tools for binary or large source files: ${change.path}`);
    const before = bytes?.toString('utf8') ?? null;
    if (typeof change.content !== 'string' && change.content !== null)
      throw new Error('File content must be text or null for deletion.');
    if (
      change.content !== null &&
      (Buffer.byteLength(change.content) > 1_000_000 || change.content.includes('\0'))
    )
      throw new Error('Use ordinary file tools for binary content or changes over 1 MB.');
    if (before !== change.content) edits.push({ path: change.path, before, after: change.content });
  }
  return edits;
}

/** Apply a verified file transition without replacing a concurrent edit. */
export async function writeProjectChange(root, entry) {
  const file = await projectFile(root, entry.path, { writable: true });
  const check = async () => {
    await projectFile(root, entry.path, { writable: true });
    const current = await readOptional(file);
    if (matches(current, entry.after)) return false;
    if (!matches(current, entry.before)) throw conflict(entry.path);
    return true;
  };
  if (!(await check())) return;
  if (entry.after === null) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  const mode = await stat(file).then(
    (info) => info.mode,
    (error) => {
      if (error.code === 'ENOENT') return 0o644;
      throw error;
    },
  );
  const temporary = join(dirname(file), '.vstory-edit-' + randomUUID());
  try {
    await writeFile(temporary, entry.after, { flag: 'wx', mode });
    if (await check()) await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Working documents and undo journals; the renderer owns neither files nor authoring history. */
export class ProjectStore {
  constructor(data) {
    this.data = data;
    this.projects = new Map();
    this.queues = new Map();
  }
  async start() {
    for (const item of (await readJSON(join(this.data, 'projects.json'))) ?? [])
      this.projects.set(item.id, item);
  }
  async remember(item) {
    this.registrySave = (this.registrySave ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const next = new Map(this.projects).set(item.id, item);
        await writeJSON(join(this.data, 'projects.json'), [...next.values()]);
        this.projects.set(item.id, item);
      });
    await this.registrySave;
    return item;
  }
  async create(path, options) {
    await mkdir(path, { recursive: true });
    path = await realpath(path);
    return this.serial('path:' + path, async () => {
      if ((await readdir(path)).length)
        throw new Error(
          'Choose an empty directory for a new project. Open an existing project by its path.',
        );
      return this.registerPath(path, options);
    });
  }
  async register(path, options) {
    path = await realpath(path);
    if (!(await stat(path)).isDirectory())
      throw new Error(
        'Open the project directory or its story.vstory file. Open a standalone HTML export in a browser; editing requires its source project.',
      );
    return this.serial('path:' + path, () => this.registerPath(path, options));
  }
  async registerPath(path, { title, example } = {}) {
    const manifestFile = join(path, 'story.vstory');
    let manifest = await readJSON(manifestFile);
    if (!manifest) {
      manifest = { format: 1, id: randomUUID(), title: title ?? basename(path), example };
      try {
        await writeFile(manifestFile, JSON.stringify(manifest), { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        manifest = await readJSON(manifestFile);
      }
    }
    if (manifest?.format !== 1 || !/^[a-f0-9-]{36}$/.test(manifest.id))
      throw new Error('Unsupported story.vstory manifest.');
    const known = this.projects.get(manifest.id);
    if (known && known.path !== path) {
      const previous = await realpath(known.path).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (previous && previous !== path) {
        manifest.id = randomUUID();
        await writeJSON(manifestFile, manifest);
      }
    }
    const item = await this.remember({
      ...this.projects.get(manifest.id),
      ...manifest,
      path,
      openedAt: new Date().toISOString(),
    });
    return this.serial(item.id, async () => {
      await this.recover(item);
      return this.inspect(item.id);
    });
  }
  get(id) {
    const p = this.projects.get(id);
    if (!p) throw new Error('Project is not open. Open its directory first.');
    return p;
  }
  async inspect(id) {
    const { creation: _creation, ...p } = this.get(id),
      source = await projectFiles(p.path);
    return {
      ...p,
      // A broken draft still exposes files and their revision so it can be repaired.
      entry: await sceneEntry(p.path).then(
        (entry) => entry.source,
        () => undefined,
      ),
      sourceRevision: source.revision,
      files: source.files,
    };
  }
  async list() {
    return [...this.projects.values()]
      .map(({ creation: _creation, ...project }) => project)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }
  creation(requestId) {
    return [...this.projects.values()].find((item) => item.creation?.requestId === requestId);
  }
  serial(id, work) {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.queues.set(id, next);
    void next
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async read(id, name) {
    return readProjectFile(this.get(id).path, name);
  }
  async editDelivery(id, requestId, delivery) {
    if (!validRequest(requestId)) throw new Error('Invalid authoring request ID.');
    const directory = await this.historyDirectory(this.get(id));
    const file = join(directory, 'history', requestId + '.json');
    const journal = await readJSON(file);
    if (!journal) throw new Error('The authoring transaction has no receipt.');
    if (delivery !== undefined) await writeJSON(file, { ...journal, delivery });
    return delivery ?? journal.delivery;
  }
  async historyDirectory(project) {
    const directory = join(project.path, '.vstory');
    for (const path of [directory, join(directory, 'history')]) {
      await mkdir(path, { recursive: true });
      if ((await realpath(path)) !== path)
        throw new Error('Project history must be stored inside .vstory without links.');
    }
    return directory;
  }
  async recover(project) {
    const file = join(project.path, '.vstory/transaction.json'),
      journal = await readJSON(file);
    if (!journal) return;
    const directory = await this.historyDirectory(project);
    const cursor = (await readJSON(join(directory, 'history.json')))?.cursor ?? null;
    if (
      !validRequest(journal.requestId) ||
      !Array.isArray(journal.changes) ||
      journal.changes.length > 64 ||
      journal.changes.some(
        (entry) =>
          !entry ||
          [entry.before, entry.after].some((value) => value !== null && typeof value !== 'string'),
      ) ||
      !journal.history ||
      !validCursor(journal.history.before) ||
      !validCursor(journal.history.after) ||
      ![journal.history.before, journal.history.after].includes(cursor)
    )
      throw new Error(
        'Interrupted edit conflicts with the authoring history. Resolve .vstory/transaction.json first.',
      );
    for (const entry of journal.changes) {
      const current = await readOptional(
        await projectFile(project.path, entry.path, { writable: true }),
      );
      if (!matches(current, entry.before) && !matches(current, entry.after))
        throw conflict(entry.path);
    }
    // Recheck at each write boundary and after the whole series. Conflicts retain the journal.
    for (const entry of journal.changes) await this.write(project.path, entry);
    for (const entry of journal.changes) {
      const current = await readOptional(
        await projectFile(project.path, entry.path, { writable: true }),
      );
      if (!matches(current, entry.after)) throw conflict(entry.path);
    }
    const receipt = {
      ...(await this.inspect(project.id)),
      ...(journal.semantic ? { semantic: true, authoredInputs: journal.authoredInputs ?? [] } : {}),
    };
    await writeJSON(join(directory, 'history', journal.requestId + '.json'), {
      ...journal,
      receipt,
    });
    await writeJSON(join(directory, 'history.json'), { cursor: journal.history.after });
    await rm(file);
  }
  write(root, entry) {
    return writeProjectChange(root, entry);
  }
  async resolveEdit(p, state, { requestId, changes, operations, undo, assets = [] }, directory) {
    const cursor = (await readJSON(join(directory, 'history.json')))?.cursor ?? null;
    if (!validCursor(cursor))
      throw new Error('Invalid authoring history cursor. Resolve .vstory/history.json first.');
    let next = requestId;
    let semantic = operations !== undefined;
    let authoredInputs = [];
    if (undo) {
      const last = cursor && (await readJSON(join(directory, 'history', cursor + '.json')));
      if (!last) throw new Error('No authored edit to undo.');
      changes = last.changes.map((entry) => ({ path: entry.path, content: entry.before }));
      next = last.history.before;
      semantic = last.semantic === true;
      if (semantic) authoredInputs = last.authoredInputs ?? [];
      for (const entry of last.changes) {
        const current = state.files[entry.path] ?? null,
          expected = entry.after === null ? null : digest(entry.after);
        if (current !== expected)
          throw failure(
            'undo_conflict',
            `Undo would replace an external change in ${entry.path}. Read it first.`,
            { field: entry.path, action: 'story_inspect' },
          );
      }
    }
    if (operations !== undefined) {
      if (changes !== undefined || undo || assets.length)
        throw new Error('Choose semantic operations, file changes, or undo.');
      const { editExplanation } = await explanationAPI(p.path);
      const document = await readJSON(join(p.path, 'explanation.json'));
      changes = [
        {
          path: 'explanation.json',
          content: JSON.stringify(editExplanation(document, operations), null, 2) + '\n',
        },
      ];
      authoredInputs = [
        ...new Set(
          operations.flatMap((operation) =>
            operation.op === 'set-inputs' ? Object.keys(operation.values) : [],
          ),
        ),
      ];
    }
    if (semantic) await assertPreparedExplanation(p.path);
    const document = semantic
      ? (await explanationAPI(p.path)).validateExplanation(
          JSON.parse(changes.find((change) => change.path === 'explanation.json').content),
        )
      : undefined;
    return { cursor, next, semantic, changes, document, authoredInputs };
  }
  async editState({
    projectId,
    sourceRevision,
    requestId,
    changes,
    operations,
    undo,
    assets = [],
  }) {
    if (!validRequest(requestId))
      throw new Error('requestId must contain 8–100 letters, digits, underscores or hyphens.');
    const p = this.get(projectId);
    await this.recover(p);
    const directory = await this.historyDirectory(p);
    const signature = digest(
      JSON.stringify({
        sourceRevision,
        changes,
        operations,
        undo,
        assets: assets.map(({ path, hash }) => ({ path, hash })),
      }),
    );
    const prior = await readJSON(join(directory, 'history', requestId + '.json'));
    if (prior) {
      if (prior.signature !== signature)
        throw new Error('requestId already belongs to a different edit.');
      return {
        prior: { ...(prior.receipt ?? (await this.inspect(projectId))), requestId, repeated: true },
      };
    }
    const state = await this.inspect(projectId);
    if (state.sourceRevision !== sourceRevision)
      throw failure(
        'source_conflict',
        `Source conflict. Expected ${sourceRevision}; current ${state.sourceRevision}. Read the changed files before retrying.`,
        {
          field: 'sourceRevision',
          current: { sourceRevision: state.sourceRevision },
          action: 'story_inspect',
        },
      );
    return { p, directory, signature, state };
  }
  prepareSemanticEdit(args) {
    return this.serial(args.projectId, async () => {
      const input = await this.editState(args);
      if (input.prior) return undefined;
      const resolved = await this.resolveEdit(input.p, input.state, args, input.directory);
      return resolved.semantic
        ? { document: resolved.document, authoredInputs: resolved.authoredInputs }
        : undefined;
    });
  }
  edit({ projectId, sourceRevision, requestId, changes, operations, undo, assets = [] }) {
    return this.serial(projectId, async () => {
      const input = await this.editState({
        projectId,
        sourceRevision,
        requestId,
        changes,
        operations,
        undo,
        assets,
      });
      if (input.prior) return input.prior;
      const { p, directory, signature, state } = input;
      const journalPath = join(directory, 'transaction.json');
      // Migration adds immutable packages; undo retains the previous package and restores its lockfile.
      for (const asset of assets) {
        if (!/^dependencies\/visual-storytelling-core-[a-f0-9]{64}\.tgz$/.test(asset.path))
          throw new Error('Migration assets must be content-addressed runtime archives.');
        const bytes = await readFile(asset.source);
        if (digest(bytes) !== asset.hash || !asset.path.includes(asset.hash))
          throw new Error('Runtime archive integrity changed.');
        const target = await projectFile(p.path, asset.path, { writable: true });
        await mkdir(dirname(target), { recursive: true });
        try {
          await copyFile(asset.source, target, constants.COPYFILE_EXCL);
        } catch (error) {
          if (error.code !== 'EEXIST' || digest(await readFile(target)) !== asset.hash) throw error;
        }
        state.files[asset.path] = asset.hash;
      }
      if (assets.length) {
        const current = await projectFiles(p.path);
        if (
          Object.keys(current.files).length !== Object.keys(state.files).length ||
          Object.entries(current.files).some(([name, hash]) => state.files[name] !== hash)
        )
          throw failure('source_conflict', 'Source changed while preparing the runtime update.', {
            action: 'story_inspect',
          });
        state.sourceRevision = current.revision;
      }
      const {
        cursor,
        next,
        semantic,
        authoredInputs,
        changes: resolvedChanges,
      } = await this.resolveEdit(
        p,
        state,
        { requestId, changes, operations, undo, assets },
        directory,
      );
      const edits = await prepareProjectChanges(p.path, resolvedChanges);
      if ((await projectFiles(p.path)).revision !== state.sourceRevision)
        throw new Error('Source changed while preparing this edit. Inspect before retrying.');
      const journal = {
        requestId,
        signature,
        createdAt: new Date().toISOString(),
        ...(semantic ? { semantic: true, authoredInputs } : {}),
        changes: edits,
        history: { before: cursor, after: edits.length ? next : cursor },
      };
      await writeJSON(journalPath, journal);
      await this.recover(p);
      return {
        ...(await this.inspect(projectId)),
        requestId,
        ...(semantic ? { semantic: true, authoredInputs } : {}),
      };
    });
  }
}

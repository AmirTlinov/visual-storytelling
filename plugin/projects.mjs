import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  realpath,
  readdir,
  stat,
  lstat,
  copyFile,
  link,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readJSON, writeJSON } from '../tools/storage.mjs';
import { projectFiles, projectFile, readProjectFile, digest } from '../tools/project-files.mjs';
import { failure } from './errors.mjs';
import { sceneEntry } from '../tools/scene-entry.mjs';
import { storyDocumentAPI, assertPreparedDocument } from '../tools/runtime-package.mjs';

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
const validAsset = (asset) =>
  asset &&
  /^[a-f0-9]{64}$/.test(asset.hash) &&
  asset.path === `dependencies/visual-storytelling-core-${asset.hash}.tgz`;

async function copyImmutableAsset(source, target, hash) {
  const existing = await readOptional(target);
  if (existing) {
    if (digest(existing) !== hash) throw new Error('Runtime archive integrity changed.');
    return;
  }
  if (digest(await readFile(source)) !== hash)
    throw new Error('Runtime archive integrity changed.');
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), '.vstory-asset-' + randomUUID());
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    if (digest(await readFile(temporary)) !== hash)
      throw new Error('Runtime archive integrity changed.');
    try {
      await link(temporary, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if (digest(await readFile(target)) !== hash)
      throw new Error('Runtime archive integrity changed.');
  } finally {
    await rm(temporary, { force: true });
  }
}

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
  remember(item) {
    return this.#publish(item.id, () => item);
  }
  /** Derive metadata from the last committed record inside the single registry queue. */
  update(id, patch) {
    return this.#publish(id, () => {
      const current = this.get(id);
      const changes = typeof patch === 'function' ? patch(current) : patch;
      return changes === undefined ? current : { ...current, ...changes };
    });
  }
  async #publish(id, update) {
    let item;
    this.registrySave = (this.registrySave ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        item = update();
        if (item.id !== id) throw new Error('A registry update cannot change project identity.');
        if (item === this.projects.get(id)) return;
        const next = new Map(this.projects).set(id, item);
        await writeJSON(join(this.data, 'projects.json'), [...next.values()]);
        this.projects.set(item.id, item);
      });
    await this.registrySave;
    return item;
  }
  async create(path, options) {
    path = await this.canonicalPath(path);
    return this.serial('path:' + path, async () => {
      const creation = options?.creation && {
        requestId: options.creation.requestId,
        input: {
          ...options.creation.input,
          ...(options.creation.input.path !== undefined ? { path } : {}),
        },
      };
      const reserved = creation && this.creation(creation.requestId);
      if (
        [...this.projects.values()].some(
          (project) => project.path === path && project.id !== reserved?.id,
        )
      )
        throw new Error(
          'Choose an empty directory. This directory already belongs to another project.',
        );
      if (
        reserved &&
        (reserved.path !== path || !isDeepStrictEqual(reserved.creation.input, creation.input))
      )
        throw new Error('requestId already belongs to another project creation.');
      const manifest = reserved && (await readJSON(join(path, 'story.vstory')));
      if (manifest && manifest.id !== reserved.id)
        throw new Error('The reserved project directory contains another story.vstory.');
      const names = await readdir(path).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      if (!manifest && names.length)
        throw new Error(
          'Choose an empty directory for a new project. Open an existing project by its path.',
        );
      if (creation && !reserved) {
        // Commit identity and request together before publishing any project files.
        // A retry can recover the exact path even if manifest creation is interrupted.
        await this.remember({
          format: 1,
          id: randomUUID(),
          title: options.title ?? basename(path),
          example: options.example,
          path,
          openedAt: new Date().toISOString(),
          creation,
        });
      }
      await mkdir(path, { recursive: true });
      if ((await realpath(path)) !== path)
        throw new Error('The project directory changed while reserving its creation.');
      return this.registerPath(path, options);
    });
  }
  async canonicalPath(path) {
    path = resolve(path);
    try {
      return await realpath(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return join(await this.canonicalPath(dirname(path)), basename(path));
    }
  }
  async register(path, options) {
    path = await realpath(path);
    if (!(await stat(path)).isDirectory())
      throw new Error(
        'Open the project directory or its story.vstory file. Open a standalone HTML export in a browser; editing requires its source project.',
      );
    return this.serial('path:' + path, () => this.registerPath(path, options));
  }
  async registerPath(path, { title, example, creation } = {}) {
    const manifestFile = join(path, 'story.vstory');
    const reserved = creation
      ? this.creation(creation.requestId)
      : [...this.projects.values()].find(
          (project) => project.path === path && project.creation && !project.creation.receipt,
        );
    let manifest = await readJSON(manifestFile);
    if (!manifest) {
      if (reserved && (await readdir(path)).length)
        throw new Error('The reserved project directory changed before its manifest was created.');
      manifest = {
        format: 1,
        id: reserved?.id ?? randomUUID(),
        title: reserved?.title ?? title ?? basename(path),
        example: reserved?.example ?? example,
      };
      try {
        await writeFile(manifestFile, JSON.stringify(manifest), { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        manifest = await readJSON(manifestFile);
      }
    }
    if (manifest?.format !== 1 || !/^[a-f0-9-]{36}$/.test(manifest.id))
      throw new Error('Unsupported story.vstory manifest.');
    if (reserved && (reserved.id !== manifest.id || reserved.path !== path))
      throw new Error('The reserved project directory contains another story.vstory.');
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
    const registration = {
      ...manifest,
      path,
      openedAt: new Date().toISOString(),
    };
    const item =
      reserved ??
      (await (this.projects.has(manifest.id)
        ? this.update(manifest.id, registration)
        : this.remember(registration)));
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
    await this.assertIdentity(project);
    if (journal.projectId !== undefined && journal.projectId !== project.id)
      throw failure('project_conflict', 'Interrupted edit belongs to another project identity.');
    if (
      journal.assets !== undefined &&
      (!Array.isArray(journal.assets) || journal.assets.some((asset) => !validAsset(asset)))
    )
      throw new Error('Interrupted edit contains invalid runtime assets.');
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
    // The durable journal owns asset publication too; the old pin survives until this boundary.
    for (const asset of journal.assets ?? []) {
      await this.assertIdentity(project);
      await this.publishAsset(project, asset);
    }
    // Recheck at each write boundary and after the whole series. Conflicts retain the journal.
    for (const entry of journal.changes) {
      await this.assertIdentity(project);
      await this.write(project.path, entry);
    }
    for (const entry of journal.changes) {
      const current = await readOptional(
        await projectFile(project.path, entry.path, { writable: true }),
      );
      if (!matches(current, entry.after)) throw conflict(entry.path);
    }
    await this.assertIdentity(project);
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
    for (const asset of journal.assets ?? [])
      await rm(join(directory, 'assets', asset.hash + '.tgz'), { force: true });
  }
  async assetDirectory(project) {
    const directory = join(await this.historyDirectory(project), 'assets');
    await mkdir(directory, { recursive: true });
    if ((await realpath(directory)) !== directory)
      throw new Error('Transaction assets must be stored inside .vstory without links.');
    return directory;
  }
  async publishAsset(project, asset) {
    const target = await projectFile(project.path, asset.path, { writable: true });
    const existing = await readOptional(target);
    if (existing) {
      if (digest(existing) !== asset.hash) throw new Error('Runtime archive integrity changed.');
      return;
    }
    await copyImmutableAsset(
      join(await this.assetDirectory(project), asset.hash + '.tgz'),
      target,
      asset.hash,
    );
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
      const { editStoryDocument, authoredInputKeys } = await storyDocumentAPI(p.path);
      const document = await readJSON(join(p.path, 'story.json'));
      changes = [
        {
          path: 'story.json',
          content: JSON.stringify(editStoryDocument(document, operations), null, 2) + '\n',
        },
      ];
      authoredInputs = [
        ...new Set(
          operations.flatMap((operation) =>
            operation.op === 'set-inputs'
              ? authoredInputKeys(document, operation.modelId, operation.values)
              : [],
          ),
        ),
      ];
    }
    if (semantic) await assertPreparedDocument(p.path);
    const document = semantic
      ? (await storyDocumentAPI(p.path)).prepareIllustratedDocument(
          JSON.parse(changes.find((change) => change.path === 'story.json').content),
        ).document
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
    await this.assertIdentity(p);
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
  async assertIdentity(project) {
    const file = join(project.path, 'story.vstory');
    const info = await lstat(file).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const manifest = info?.isFile() ? await readJSON(file) : undefined;
    if (manifest?.format !== 1 || manifest.id !== project.id)
      throw failure('project_conflict', 'Project identity changed. Open its directory again.');
  }
  /** Prepare exactly one proposal before renderer validation; no authored files change here. */
  stageEdit(args) {
    args = structuredClone(args);
    return this.serial(args.projectId, async () => {
      const input = await this.editState(args);
      if (input.prior) return { args, prior: input.prior };
      const { p, state, directory, signature } = input;
      const resolved = await this.resolveEdit(p, state, args, directory);
      const edits = await prepareProjectChanges(p.path, resolved.changes);
      const assets = args.assets ?? [];
      if (
        assets.some((asset) => !validAsset(asset)) ||
        new Set(assets.map((asset) => asset.path)).size !== assets.length
      )
        throw new Error('Migration assets must be distinct content-addressed runtime archives.');
      for (const asset of assets) {
        if (digest(await readFile(asset.source)) !== asset.hash)
          throw new Error('Runtime archive integrity changed.');
        const target = await projectFile(p.path, asset.path, { writable: true });
        const existing = await readOptional(target);
        if (existing && digest(existing) !== asset.hash)
          throw new Error('Runtime archive integrity changed.');
      }
      if ((await projectFiles(p.path)).revision !== state.sourceRevision)
        throw new Error('Source changed while preparing this edit. Inspect before retrying.');
      await this.assertIdentity(p);
      return { args, path: p.path, signature, ...resolved, edits, assets };
    });
  }
  /** Recheck source, history and identity, then let the existing journal own all publication. */
  commitPreparedEdit(prepared) {
    const { args } = prepared;
    return this.serial(args.projectId, async () => {
      const input = await this.editState(args);
      if (input.prior) return input.prior;
      const { p, directory, state } = input;
      if (p.path !== prepared.path || input.signature !== prepared.signature)
        throw new Error('Project changed while validating this edit. Inspect before retrying.');
      const check = async () => {
        await this.assertIdentity(p);
        if ((await projectFiles(p.path)).revision !== state.sourceRevision)
          throw new Error('Source changed while validating this edit. Inspect before retrying.');
        const cursor = (await readJSON(join(directory, 'history.json')))?.cursor ?? null;
        if (cursor !== prepared.cursor)
          throw failure(
            'history_conflict',
            'Authoring history changed while validating this edit.',
            { action: 'story_inspect' },
          );
      };
      await check();
      // Copy to private recovery storage first. A failed journal write leaves the authored pin intact.
      for (const asset of prepared.assets) {
        const target = join(await this.assetDirectory(p), asset.hash + '.tgz');
        await copyImmutableAsset(asset.source, target, asset.hash);
      }
      await check();
      const { semantic, authoredInputs, edits, cursor, next } = prepared;
      await writeJSON(join(directory, 'transaction.json'), {
        projectId: p.id,
        requestId: args.requestId,
        signature: prepared.signature,
        createdAt: new Date().toISOString(),
        ...(semantic ? { semantic: true, authoredInputs } : {}),
        ...(prepared.assets.length
          ? { assets: prepared.assets.map(({ path, hash }) => ({ path, hash })) }
          : {}),
        changes: edits,
        history: { before: cursor, after: edits.length ? next : cursor },
      });
      await this.recover(p);
      return {
        ...(await this.inspect(args.projectId)),
        requestId: args.requestId,
        ...(semantic ? { semantic: true, authoredInputs } : {}),
      };
    });
  }
  async edit(args) {
    return this.commitPreparedEdit(await this.stageEdit(args));
  }
}

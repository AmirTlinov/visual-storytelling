import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Derive discovery from the declarations shipped to the consumer. */
export async function buildAPI(root, output) {
  const { default: ts } = await import('typescript');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const entries = Object.entries(pkg.exports).filter(([, entry]) => entry.types);
  const declarationPath = (types) =>
    resolve(output, relative(join(root, 'dist'), resolve(root, types)));
  const program = ts.createProgram(
    entries.map(([, entry]) => declarationPath(entry.types)),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    },
  );
  const checker = program.getTypeChecker();
  const modules = {},
    publicDeclarations = [],
    publicNames = new Map();
  const localFile = (node) => {
    const file = relative(output, node.getSourceFile().fileName);
    return !isAbsolute(file) && file.split(sep)[0] !== '..' ? file.split(sep).join('/') : undefined;
  };
  for (const [entry, { types }] of entries) {
    const source = program.getSourceFile(declarationPath(types));
    const module = checker.getSymbolAtLocation(source);
    const symbols = {};
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      // Namespaces can forward an external package; retain the local export declaration.
      const declarations = [...(symbol.declarations ?? []), ...(exported.declarations ?? [])];
      const declaration = declarations.find((node) => localFile(node) !== undefined);
      if (declaration) {
        symbols[exported.name] = localFile(declaration);
        publicDeclarations.push({ entry, name: exported.name, declaration });
        if (!publicNames.has(symbol)) publicNames.set(symbol, new Set());
        publicNames.get(symbol).add(exported.name);
      }
    }
    modules[entry] = Object.fromEntries(
      Object.entries(symbols).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  // Ship the declaration graph, not a second handwritten API catalogue. The
  // consumer can expand argument types without installing TypeScript or src/.
  const declarations = {},
    signatures = {},
    members = {};
  const statement = (node) => {
    while (node.parent && !ts.isSourceFile(node.parent)) node = node.parent;
    return node;
  };
  const names = (node) =>
    ts.isVariableStatement(node)
      ? node.declarationList.declarations.map((d) => d.name)
      : node.name
        ? [node.name]
        : [];
  function collect(node, member = false) {
    const owner = member ? node : statement(node),
      file = localFile(owner),
      id = `${file}:${owner.pos}`;
    if (declarations[id]) return id;
    const record = {
      file,
      type: ts.isInterfaceDeclaration(owner) || ts.isTypeAliasDeclaration(owner),
      text: owner.getFullText().trim(),
      imports: [],
      dependencies: [],
      related: [],
    };
    declarations[id] = record;
    const imports = new Set(),
      dependencies = new Set(),
      related = new Set();
    function visit(node) {
      if (ts.isIdentifier(node)) {
        let symbol = checker.getSymbolAtLocation(node);
        if (symbol?.flags & ts.SymbolFlags.Alias) {
          for (const alias of symbol.declarations ?? []) {
            const source = statement(alias);
            if (ts.isImportDeclaration(source)) imports.add(source.getFullText().trim());
          }
          symbol = checker.getAliasedSymbol(symbol);
        }
        for (const declaration of symbol?.declarations ?? []) {
          if (
            declaration.getSourceFile() === owner.getSourceFile() &&
            declaration.pos >= owner.pos &&
            declaration.end <= owner.end
          )
            continue;
          const dependency = statement(declaration);
          if (dependency === owner || localFile(dependency) === undefined) continue;
          if (ts.isImportDeclaration(dependency) || ts.isExportDeclaration(dependency)) continue;
          if (
            ts.isModuleDeclaration(dependency) &&
            dependency.flags & ts.NodeFlags.GlobalAugmentation
          )
            continue;
          const type =
            ts.isInterfaceDeclaration(dependency) || ts.isTypeAliasDeclaration(dependency);
          const apis = names(dependency).flatMap((name) => [
            ...(publicNames.get(checker.getSymbolAtLocation(name)) ?? []),
          ]);
          if (!type && dependency.getSourceFile() !== owner.getSourceFile() && apis.length)
            apis.forEach((name) => related.add(name));
          else dependencies.add(collect(dependency));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(owner);
    record.imports = [...imports];
    record.dependencies = [...dependencies];
    record.related = [...related];
    return id;
  }
  for (const { entry, name, declaration } of publicDeclarations) {
    (signatures[entry] ??= {})[name] = collect(declaration);
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (!symbol) continue;
    const type =
      ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)
        ? checker.getDeclaredTypeOfSymbol(symbol)
        : checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const properties = {};
    for (const property of checker.getPropertiesOfType(type)) {
      const node = property.declarations?.find((node) => localFile(node) !== undefined);
      if (!node) continue;
      const callable = checker
        .getSignaturesOfType(
          checker.getTypeOfSymbolAtLocation(property, node),
          ts.SignatureKind.Call,
        )[0]
        ?.getDeclaration();
      const id = collect(callable && localFile(callable) !== undefined ? callable : node, true);
      properties[property.name] = { id, callable: !!callable };
    }
    if (Object.keys(properties).length) (members[entry] ??= {})[name] = properties;
  }
  await writeFile(
    join(output, 'api.json'),
    JSON.stringify({ name: pkg.name, modules, signatures, members, declarations }, null, 2) + '\n',
  );
}

/** Read actual public signatures without requiring TypeScript or implementation sources. */
export async function describeAPI(root, ...queries) {
  return describeAPIData(
    JSON.parse(await readFile(join(root, 'dist/api.json'), 'utf8')),
    root,
    ...queries,
  );
}

/** The same declaration reader works before dependencies exist, using the pinned archive. */
export function describeAPIData(api, root, ...queries) {
  const full = queries.includes('--full');
  queries = queries.filter((query) => query !== '--full');
  const { name, modules, signatures, members, declarations } = api;
  const importName = (entry) => name + (entry === '.' ? '' : entry.slice(1));
  // Dedicated entry points avoid pulling aggregate browser assets into pure helpers.
  const entries = Object.entries(modules).sort(([a], [b]) => Number(a === '.') - Number(b === '.'));
  const listing = (entries) =>
    entries
      .map(([entry, symbols]) => `${importName(entry)}\n  ${Object.keys(symbols).join(', ')}`)
      .join('\n\n');
  if (!queries.length)
    return {
      text:
        listing(Object.entries(modules)) +
        '\n\nInspect: visual-story api SceneShell.mount SceneOptions\nExpand related declarations: add --full',
      missing: [],
    };
  const blocks = [],
    missing = [],
    requested = new Map(),
    selected = new Set();
  for (const query of new Set(queries)) {
    if (modules[query]) {
      blocks.push(listing([[query, modules[query]]]));
      continue;
    }
    if (query === '.' || query.startsWith('./')) {
      missing.push(
        `No public entry point "${query}" in this runtime. Available: ${Object.keys(modules).join(', ')}.`,
      );
      continue;
    }
    const [requestedName, member] = query.split('.');
    let matches = entries.flatMap(([entry, symbols]) =>
      Object.entries(symbols)
        .filter(([symbol]) => symbol.toLowerCase() === requestedName.toLowerCase())
        .map(([symbol, file]) => ({
          entry,
          symbol,
          file,
          id: member ? members?.[entry]?.[symbol]?.[member]?.id : signatures[entry][symbol],
        }))
        .filter((match) => match.id),
    );
    // An instance method is discoverable without knowing the handle type's name.
    if (!matches.length && !member) {
      matches = Object.entries(members ?? {}).flatMap(([entry, owners]) =>
        Object.entries(owners).flatMap(([symbol, properties]) =>
          Object.entries(properties)
            .filter(
              ([name, { callable }]) =>
                name.toLowerCase() === requestedName.toLowerCase() && callable,
            )
            .map(([, { id }]) => ({ entry, symbol, id })),
        ),
      );
    }
    if (!matches.length) {
      const words = (name) =>
        name
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .toLowerCase()
          .split(/[^a-z0-9]+/);
      const requestedWords = words(requestedName);
      const candidates = [...new Set(Object.values(modules).flatMap(Object.keys))]
        .map((symbol) => ({
          symbol,
          score: symbol.toLowerCase().includes(requestedName.toLowerCase())
            ? 10
            : words(symbol).reduce(
                (score, word) =>
                  score +
                  (word === requestedWords.at(-1) ? 4 : requestedWords.includes(word) ? 1 : 0),
                0,
              ),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            a.symbol.length - b.symbol.length ||
            a.symbol.localeCompare(b.symbol),
        )
        .slice(0, 8)
        .map((candidate) => candidate.symbol);
      missing.push(
        `No public symbol "${query}". ${candidates.length ? `Matches: ${candidates.join(', ')}.` : 'Run visual-story api to list the public API.'}`,
      );
      continue;
    }
    for (const { entry, symbol, id } of matches) {
      const file = declarations[id].file;
      if (selected.has(id)) continue;
      if (!requested.has(file)) requested.set(file, new Set());
      requested
        .get(file)
        .add(
          `import${declarations[signatures[entry][symbol]].type ? ' type' : ''} { ${symbol} } from '${importName(entry)}';`,
        );
      selected.add(id);
    }
  }
  const expanded = new Set(),
    files = new Map(),
    related = new Set();
  const publicById = new Map();
  for (const symbols of Object.values(signatures))
    for (const [symbol, id] of Object.entries(symbols))
      if (!publicById.has(id)) publicById.set(id, symbol);
  function expand(id) {
    if (expanded.has(id)) return;
    expanded.add(id);
    const record = declarations[id];
    if (!files.has(record.file)) files.set(record.file, []);
    files.get(record.file).push(record);
    record.related.forEach((name) => related.add(name));
    for (const dependency of record.dependencies) {
      if (full || !record.type || selected.has(dependency) || !publicById.has(dependency))
        expand(dependency);
      else related.add(publicById.get(dependency));
    }
  }
  for (const id of selected) expand(id);
  for (const file of [...requested.keys(), ...[...files.keys()].filter((f) => !requested.has(f))]) {
    const records = files.get(file),
      imports = [...new Set(records.flatMap((r) => r.imports))];
    const publicImports = new Map();
    for (const [entry, symbols] of entries)
      for (const [symbol, source] of Object.entries(symbols)) {
        const id = signatures[entry][symbol];
        if (source === file && expanded.has(id) && declarations[id].type && !publicImports.has(id))
          publicImports.set(id, `import type { ${symbol} } from '${importName(entry)}';`);
      }
    const header = requested.has(file)
      ? `${[...requested.get(file)].join('\n')}\nDeclaration:`
      : `${[...publicImports.values()].join('\n')}\nRelated types:`.trim();
    blocks.push(
      `${header} ${join(root, 'dist', file)}\n\n${[...imports, ...records.map((r) => r.text)].join('\n\n')}`,
    );
  }
  const relatedNames = [...related].filter(
    (name) => !queries.some((q) => q.toLowerCase() === name.toLowerCase()),
  );
  if (relatedNames.length)
    blocks.push(`Related API: visual-story api ${relatedNames.sort().join(' ')}`);
  return { text: [...blocks, ...missing].join('\n\n'), missing };
}

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
    signatures = {};
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
  function collect(node) {
    const owner = statement(node),
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
          const dependency = statement(declaration);
          if (dependency === owner || localFile(dependency) === undefined) continue;
          if (ts.isImportDeclaration(dependency) || ts.isExportDeclaration(dependency)) continue;
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
  }
  await writeFile(
    join(output, 'api.json'),
    JSON.stringify({ name: pkg.name, modules, signatures, declarations }, null, 2) + '\n',
  );
}

/** Read actual public signatures without requiring TypeScript or implementation sources. */
export async function describeAPI(root, ...queries) {
  const { name, modules, signatures, declarations } = JSON.parse(
    await readFile(join(root, 'dist/api.json'), 'utf8'),
  );
  const importName = (entry) => name + (entry === '.' ? '' : entry.slice(1));
  const listing = (entries) =>
    entries
      .map(([entry, symbols]) => `${importName(entry)}\n  ${Object.keys(symbols).join(', ')}`)
      .join('\n\n');
  if (!queries.length)
    return {
      text:
        listing(Object.entries(modules)) + '\n\nInspect a signature: visual-story api SceneShell',
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
    const matches = Object.entries(modules).flatMap(([entry, symbols]) =>
      Object.entries(symbols)
        .filter(([symbol]) => symbol.toLowerCase() === query.toLowerCase())
        .map(([symbol, file]) => ({ entry, symbol, file })),
    );
    if (!matches.length) {
      const candidates = [...new Set(Object.values(modules).flatMap(Object.keys))].filter(
        (symbol) => symbol.toLowerCase().includes(query.toLowerCase()),
      );
      missing.push(
        `No public symbol "${query}". ${candidates.length ? `Matches: ${candidates.join(', ')}.` : 'Run visual-story api to list the public API.'}`,
      );
      continue;
    }
    for (const { entry, symbol, file } of matches) {
      const id = signatures[entry][symbol];
      if (selected.has(id)) continue;
      if (!requested.has(file)) requested.set(file, new Set());
      requested
        .get(file)
        .add(
          `import${declarations[id].type ? ' type' : ''} { ${symbol} } from '${importName(entry)}';`,
        );
      selected.add(id);
    }
  }
  const expanded = new Set(),
    files = new Map(),
    related = new Set();
  function expand(id) {
    if (expanded.has(id)) return;
    expanded.add(id);
    const record = declarations[id];
    if (!files.has(record.file)) files.set(record.file, []);
    files.get(record.file).push(record);
    record.related.forEach((name) => related.add(name));
    record.dependencies.forEach(expand);
  }
  selected.forEach(expand);
  for (const file of [...requested.keys(), ...[...files.keys()].filter((f) => !requested.has(f))]) {
    const records = files.get(file),
      imports = [...new Set(records.flatMap((r) => r.imports))];
    const publicImports = new Map();
    for (const [entry, symbols] of Object.entries(modules))
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

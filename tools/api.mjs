import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Derive discovery from the declarations shipped to the consumer. */
export async function buildAPI(root) {
  const { default: ts } = await import('typescript');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const entries = Object.entries(pkg.exports).filter(([, entry]) => entry.types);
  const program = ts.createProgram(
    entries.map(([, entry]) => resolve(root, entry.types)),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      skipLibCheck: true,
    },
  );
  const checker = program.getTypeChecker();
  const output = resolve(root, 'dist');
  const modules = {};
  for (const [entry, { types }] of entries) {
    const source = program.getSourceFile(resolve(root, types));
    const module = checker.getSymbolAtLocation(source);
    const symbols = {};
    for (const exported of checker.getExportsOfModule(module)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      // Namespaces can forward an external package; retain the local export declaration.
      const declarations = [...(symbol.declarations ?? []), ...(exported.declarations ?? [])];
      const declaration = declarations.find((node) => {
        const file = relative(output, node.getSourceFile().fileName);
        return !isAbsolute(file) && file.split(sep)[0] !== '..';
      });
      if (declaration)
        symbols[exported.name] = relative(output, declaration.getSourceFile().fileName)
          .split(sep)
          .join('/');
    }
    modules[entry] = Object.fromEntries(
      Object.entries(symbols).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  await writeFile(
    join(output, 'api.json'),
    JSON.stringify({ name: pkg.name, modules }, null, 2) + '\n',
  );
}

/** Read actual public signatures without requiring TypeScript or implementation sources. */
export async function describeAPI(root, query) {
  const { name, modules } = JSON.parse(await readFile(join(root, 'dist/api.json'), 'utf8'));
  const importName = (entry) => name + (entry === '.' ? '' : entry.slice(1));
  const listing = (entries) =>
    entries
      .map(([entry, symbols]) => `${importName(entry)}\n  ${Object.keys(symbols).join(', ')}`)
      .join('\n\n');
  if (!query)
    return (
      listing(Object.entries(modules)) + '\n\nInspect a signature: visual-story api SceneShell'
    );
  if (modules[query]) return listing([[query, modules[query]]]);
  const matches = Object.entries(modules).flatMap(([entry, symbols]) =>
    Object.entries(symbols)
      .filter(([symbol]) => symbol.toLowerCase() === query.toLowerCase())
      .map(([symbol, file]) => ({ entry, symbol, file })),
  );
  if (!matches.length) {
    const candidates = [...new Set(Object.values(modules).flatMap(Object.keys))].filter((symbol) =>
      symbol.toLowerCase().includes(query.toLowerCase()),
    );
    throw new Error(
      `No public symbol "${query}". ${candidates.length ? `Matches: ${candidates.join(', ')}.` : 'Run visual-story api to list the public API.'}`,
    );
  }
  const blocks = [];
  for (const file of new Set(matches.map((match) => match.file))) {
    const imports = matches
      .filter((match) => match.file === file)
      .map((match) => importName(match.entry));
    const path = join(root, 'dist', file);
    blocks.push(`${imports.join(' | ')}\nDeclaration: ${path}\n\n${await readFile(path, 'utf8')}`);
  }
  return blocks.join('\n\n');
}

// Maintainers run against the private application checkout; no private source is copied.
import { registerHooks, stripTypeScriptTypes, createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = realpathSync(resolve(process.env.TRUCKERFETCH_SOURCE || fileURLToPath(new URL('../../truckerfetch-com/', import.meta.url))));
const destination = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const sourcePaths = ['lib/truckerfetch/interfaces.ts', 'lib/truckerfetch/policy.ts', 'lib/truckerfetch/watch-policy.ts', 'lib/truckerfetch/watch-kinds.ts', 'lib/utils/site.ts'];
if (!existsSync(resolve(root, sourcePaths[0]))) throw new Error('Set TRUCKERFETCH_SOURCE to the application checkout');
registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL?.startsWith(pathToFileURL(root + '/').href);
    let candidate;
    if (parent && specifier.startsWith('@/')) candidate = resolve(root, specifier.slice(2));
    else if (parent && specifier.startsWith('.')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    if (candidate) {
      for (const filename of [candidate, candidate + '.ts', candidate + '.mjs', candidate + '/index.ts']) {
        if (existsSync(filename) && statSync(filename).isFile()) return { url: pathToFileURL(filename).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(pathToFileURL(root + '/').href) && url.endsWith('.ts'))
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
    return next(url, context);
  },
});
process.env.NEXT_PUBLIC_APP_URL = 'https://truckerfetch.com';
const { toolRegistry, mcpResources, resourceValue } = await import(pathToFileURL(resolve(root, sourcePaths[0])).href);
const { z } = createRequire(resolve(root, 'package.json'))('zod');
const confirmationTools = new Set(['create_watchlist', 'add_watch_target', 'add_authority_watch_target', 'remove_authority_watch_target', 'update_watch_rules', 'request_export', 'unlock_edition']);
const clockReads = new Set(['get_latest_edition', 'list_editions']);
const operations = {};
const tools = toolRegistry.map(t => {
  const route = t.target(new Proxy({}, { get: (_, name) => '{' + String(name) + '}' }));
  const pathKeys = route.flatMap(part => [...part.matchAll(/\{([^}]+)\}/g)].map(match => match[1]));
  operations[t.name] = { method: t.method, route, pathKeys, scope: t.scope, confirmation: confirmationTools.has(t.name) };
  const schema = z.toJSONSchema(t.schema, { io: 'input', unrepresentable: 'any' });
  if (confirmationTools.has(t.name)) {
    schema.properties.confirm_action = { type: 'boolean', const: true, description: 'Local bridge only: confirm this exact mutation with the user before setting true.' };
    schema.required = [...(schema.required || []), 'confirm_action'];
  }
  return {
    name: t.name,
    description: t.description + (confirmationTools.has(t.name) ? ' The local REST bridge additionally requires confirm_action=true after user approval.' : ''),
    inputSchema: schema,
    annotations: {
      readOnlyHint: !confirmationTools.has(t.name) && !clockReads.has(t.name),
      destructiveHint: ['remove_authority_watch_target', 'update_watch_rules'].includes(t.name),
      openWorldHint: false,
    },
  };
});
const resources = mcpResources.map(resource => ({ ...resource, value: resourceValue(resource.uri) }));
const hashes = Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]));
for (const [name, value] of Object.entries({ 'tools.json': tools, 'operations.json': operations, 'resources.json': resources, 'manifest-source.json': { source: 'truckerfetch-com', files: hashes, note: 'Generated public contracts only; no customer records or server source.' } })) {
  const content = JSON.stringify(value, null, 2) + '\n';
  const path = resolve(destination, name);
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== content) throw new Error('Manifest drift: ' + name + '; regenerate from the reviewed app source');
  } else writeFileSync(path, content);
}
console.log(check ? 'Manifest matches application source' : 'Generated 22 tools and reference resources from application source');

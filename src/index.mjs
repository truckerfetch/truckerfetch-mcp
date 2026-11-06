import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createClient, ClientFault, tools } from './client.mjs';
const resources = JSON.parse(readFileSync(new URL('../resources.json', import.meta.url), 'utf8'));
export function createServer(client = createClient()) {
  const server = new Server({ name: 'truckerfetch-stdio', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: resources.map(({ value, ...resource }) => resource) }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const resource = resources.find(resource => resource.uri === params.uri);
    if (!resource) throw new Error('Unknown resource');
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: JSON.stringify(resource.value) }] };
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const data = await client(params.name, params.arguments);
      const result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 90000) throw new ClientFault('response_too_large', { action: 'Narrow filters or reduce limit to 10. Retrieve CSV outside model context.' });
      return result;
    } catch (error) {
      const data = { error: { code: error instanceof ClientFault ? error.code : 'request_failed', ...(error instanceof ClientFault ? error.details : {}) } };
      return { isError: true, content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    }
  });
  return server;
}
if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  try { await createServer().connect(new StdioServerTransport()); }
  catch { process.stderr.write('TruckerFetch bridge failed to start; check configuration.\n'); process.exitCode = 1; }
}

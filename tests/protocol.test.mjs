import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';
const key = 'tf_' + 'a'.repeat(43);
test('real stdio SDK lists tools/resources and completes a read against loopback fixture', async () => {
  const requests = [];
  const http = createServer((req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { usdot: '123', legal_name: 'Synthetic fixture' }, meta: {} }));
  });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../src/index.mjs', import.meta.url).pathname], env: { PATH: process.env.PATH, TRUCKERFETCH_API_KEY: key, TRUCKERFETCH_BASE_URL: 'http://127.0.0.1:' + http.address().port, TRUCKERFETCH_ALLOW_LOCAL_TEST: '1' } });
  const client = new Client({ name: 'offline-protocol-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 22);
    assert(tools.find(tool => tool.name === 'request_export').inputSchema.required.includes('confirm_action'));
    const { resources } = await client.listResources();
    assert.equal(resources.length, 2);
    assert((await client.readResource({ uri: 'truckerfetch://reference/filters' })).contents[0].text.includes('states'));
    const result = await client.callTool({ name: 'get_carrier', arguments: { usdot: '123' } });
    assert.equal(result.structuredContent.data.legal_name, 'Synthetic fixture');
    assert.deepEqual(requests, [{ path: '/api/v1/carriers/123', auth: 'Bearer ' + key }]);
    const denied = await client.callTool({ name: 'request_export', arguments: { selection: { scope: 'catalog' }, idempotency_key: 'fixture-key' } });
    assert.equal(denied.isError, true);
    assert.equal(requests.length, 1);
  } finally { await client.close(); await new Promise(resolve => http.close(resolve)); }
});
test('generated manifest and operation coverage agree', () => {
  const tools = JSON.parse(readFileSync(new URL('../tools.json', import.meta.url)));
  const operations = JSON.parse(readFileSync(new URL('../operations.json', import.meta.url)));
  assert.deepEqual(tools.map(t => t.name).sort(), Object.keys(operations).sort());
  for (const operation of Object.values(operations)) assert(operation.route.every(segment => !segment.includes('/')));
});

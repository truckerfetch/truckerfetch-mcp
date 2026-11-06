import { readFileSync } from 'node:fs';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
const read = file => JSON.parse(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
export const tools = read('tools.json');
const operations = read('operations.json');
const validator = new AjvJsonSchemaValidator();
const validators = new Map(tools.map(tool => [tool.name, validator.getValidator(tool.inputSchema)]));
export class ClientFault extends Error {
  constructor(code, details = {}) { super(code); this.code = code; this.details = details; }
}
function validOrigin(baseUrl, allowLocalhost) {
  let url;
  try { url = new URL(baseUrl); } catch { throw new ClientFault('invalid_origin'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ClientFault('invalid_origin');
  const local = allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !(url.protocol === 'https:' && !url.port && ['truckerfetch.com', 'www.truckerfetch.com'].includes(url.hostname))) throw new ClientFault('untrusted_origin');
  return url;
}
async function boundedJson(response) {
  if (Number(response.headers.get('content-length') || 0) > 262144) throw new ClientFault('response_too_large');
  if (!response.body) throw new ClientFault('invalid_response');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) throw new ClientFault('response_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ClientFault('invalid_response'); }
}
function safeApproval(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin.origin && !url.username && !url.password && !url.search && !url.hash && /^\/developer\/confirm\/[a-f0-9-]{36}$/i.test(url.pathname) ? url.href : undefined;
  } catch { return undefined; }
}
export function createClient({ key = process.env.TRUCKERFETCH_API_KEY, baseUrl = process.env.TRUCKERFETCH_BASE_URL || 'https://truckerfetch.com', fetchImpl = fetch, allowLocalhost = process.env.TRUCKERFETCH_ALLOW_LOCAL_TEST === '1' } = {}) {
  const origin = validOrigin(baseUrl, allowLocalhost);
  return async function call(name, raw = {}) {
    const operation = operations[name];
    if (!operation) throw new ClientFault('unknown_tool');
    const args = structuredClone(raw);
    if (!validators.get(name)(args).valid) throw new ClientFault('invalid_arguments');
    if (operation.confirmation && args.confirm_action !== true) throw new ClientFault('confirmation_required');
    if (!/^tf_[A-Za-z0-9_-]{40,60}$/.test(key || '')) throw new ClientFault('configure_rest_api_key');
    if (args.idempotency_key !== undefined && !/^[-._:a-zA-Z0-9]{8,128}$/.test(args.idempotency_key)) throw new ClientFault('invalid_idempotency_key');
    if (name === 'request_export' && args.selection.scope === 'sample') throw new ClientFault('sample_dashboard_only');
    const segments = operation.route.map(segment => segment.replace(/\{([^}]+)\}/g, (_, field) => String(args[field])));
    const url = new URL('/api/v1/' + segments.map(encodeURIComponent).join('/'), origin);
    const body = name === 'request_export' ? { ...args.selection } : { ...args };
    delete body.idempotency_key; delete body.confirm_action;
    for (const field of operation.pathKeys) delete body[field];
    if (operation.method === 'GET') for (const [field, value] of Object.entries(body)) if (value !== undefined) url.searchParams.set(field, String(value));
    const headers = { Authorization: 'Bearer ' + key, Accept: 'application/json' };
    if (args.idempotency_key) headers['Idempotency-Key'] = args.idempotency_key;
    const request = { method: operation.method, headers, redirect: 'error', signal: AbortSignal.timeout(30000) };
    if (!['GET', 'DELETE'].includes(operation.method)) { headers['Content-Type'] = 'application/json'; request.body = JSON.stringify(body); }
    let response, result;
    try {
      response = await fetchImpl(url, request);
      if (response.redirected || (response.status >= 300 && response.status < 400)) throw new ClientFault('redirect_rejected');
      result = await boundedJson(response);
    } catch (error) { if (error instanceof ClientFault) throw error; throw new ClientFault('network_error'); }
    if (!response.ok) {
      const code = /^[a-z][a-z0-9_]{0,79}$/.test(result?.error?.code || '') && !result.error.code.includes(key) ? result.error.code : 'request_failed';
      const retry = response.headers.get('Retry-After');
      const requestId = response.headers.get('X-Request-Id');
      const confirmation = safeApproval(result?.confirmation_url, origin);
      const details = { status: response.status,
        ...(retry && /^\d{1,6}$/.test(retry) ? { retry_after: retry } : {}),
        ...(requestId && /^[a-zA-Z0-9-]{1,80}$/.test(requestId) ? { request_id: requestId } : {}),
        ...(confirmation ? { confirmation_url: confirmation } : {}),
        ...(args.idempotency_key ? { retry_instruction: 'After approval or a retryable failure, reuse the SAME idempotency key and exact payload. This bridge does not retry mutations.' } : {}),
      };
      throw new ClientFault(code, details);
    }
    // Do not surface credential echoes, private storage URLs, or backend diagnostics.
    const scrub = (value) => {
      if (typeof value === 'string') return value.replaceAll(key, '[REDACTED]');
      if (Array.isArray(value)) return value.map(scrub);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([field]) => !['read_url', 'access_token', 'refresh_token', 'secret', 'secret_cipher'].includes(field)).map(([field, child]) => [field, scrub(child)]));
      return value;
    };
    return scrub(result);
  };
}

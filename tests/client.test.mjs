import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.mjs';
const key = 'tf_' + 'a'.repeat(43);
const id = '73cb9f39-5454-4dcb-bc4e-095efc9d0694';
const fixture = (callback) => createClient({ key, fetchImpl: callback });
test('search sends bounded same-origin REST request without retry', async () => {
  let captured;
  const client = fixture(async (url, init) => { captured = { url, init }; return Response.json({ data: [], meta: { next_cursor: null } }); });
  await client('search_carriers', { filters: { states: ['TX'] }, limit: 10 });
  assert.equal(captured.url.href, 'https://truckerfetch.com/api/v1/carriers/search');
  assert.equal(captured.init.headers.Authorization, 'Bearer ' + key);
  assert.equal(captured.init.redirect, 'error');
  assert.equal(JSON.parse(captured.init.body).limit, 10);
});
test('rejects unknown tools, invalid paths, filters, mutations and OAuth tokens before network', async () => {
  let calls = 0;
  const client = fixture(async () => { calls++; throw new Error('network'); });
  await assert.rejects(client('unknown_tool'), /unknown_tool/);
  await assert.rejects(client('get_carrier', { usdot: '../account' }), /invalid_arguments/);
  await assert.rejects(client('search_carriers', { filters: { injected: 'bad' } }), /invalid_arguments/);
  await assert.rejects(client('create_watchlist', { name: 'test', idempotency_key: 'fixed-key' }), /invalid_arguments/);
  await assert.rejects(createClient({ key: 'tfm_' + 'a'.repeat(43) })('get_latest_edition'), /configure_rest_api_key/);
  assert.equal(calls, 0);
});
test('official origins only unless an explicit loopback test is requested', () => {
  for (const baseUrl of ['https://attacker.test', 'https://truckerfetch.com.evil.test', 'http://truckerfetch.com', 'https://u:p@truckerfetch.com', 'https://truckerfetch.com/api', 'https://truckerfetch.com/?x=1', 'http://127.0.0.1:8123']) assert.throws(() => createClient({ key, baseUrl }));
  assert.doesNotThrow(() => createClient({ key, baseUrl: 'http://127.0.0.1:8123', allowLocalhost: true }));
});
test('exports preserve exact selection and saved key; local approval is not forwarded', async () => {
  let request;
  const client = fixture(async (_, init) => { request = init; return Response.json({ data: { id, state: 'queued' }, meta: {} }, { status: 202 }); });
  await client('request_export', { selection: { scope: 'catalog', filters: { states: ['TX'] } }, idempotency_key: 'saved-key-01', confirm_action: true });
  assert.equal(request.headers['Idempotency-Key'], 'saved-key-01');
  assert.deepEqual(JSON.parse(request.body), { scope: 'catalog', filters: { states: ['TX'] } });
});
test('archival approval forwards only trusted review links and performs no automatic mutation retry', async () => {
  let calls = 0;
  const client = fixture(async () => { calls++; return Response.json({ error: { code: 'confirmation_required', message: key }, confirmation_url: 'https://truckerfetch.com/developer/confirm/' + id }, { status: 409 }); });
  await assert.rejects(client('unlock_edition', { edition_id: id, confirm_edition_date_et: '2026-11-01', idempotency_key: 'saved-key-02', confirm_action: true }), error => {
    assert.equal(error.code, 'confirmation_required');
    assert.equal(error.details.confirmation_url, 'https://truckerfetch.com/developer/confirm/' + id);
    assert(!JSON.stringify(error).includes(key));
    return true;
  });
  assert.equal(calls, 1);
  const unsafe = fixture(async () => Response.json({ error: { code: 'confirmation_required' }, confirmation_url: 'https://attacker.test/' + key }, { status: 409 }));
  await assert.rejects(unsafe('unlock_edition', { edition_id: id, confirm_edition_date_et: '2026-11-01', idempotency_key: 'saved-key-03', confirm_action: true }), error => !error.details.confirmation_url);
});
test('429 returns safe guidance once, errors do not echo server messages or credentials', async () => {
  let calls = 0;
  const client = fixture(async () => { calls++; return Response.json({ error: { code: 'rate_limited', message: key }, sql: key }, { status: 429, headers: { 'Retry-After': '60' } }); });
  await assert.rejects(client('get_latest_edition'), error => error.code === 'rate_limited' && error.details.retry_after === '60' && !JSON.stringify(error).includes(key));
  assert.equal(calls, 1);
});
test('network failures, redirects and oversized responses are bounded and scrubbed', async () => {
  await assert.rejects(fixture(async () => { throw Error(key); })('get_latest_edition'), /network_error/);
  await assert.rejects(fixture(async () => new Response('', { status: 302, headers: { Location: 'https://attacker.test' } }))('get_latest_edition'), /redirect_rejected/);
  await assert.rejects(fixture(async () => new Response('x'.repeat(262145)))('get_latest_edition'), /response_too_large/);
  const data = await fixture(async () => Response.json({ data: { text: key, read_url: 'https://private.test', secret: 'hidden' }, meta: {} }))('get_latest_edition');
  assert.deepEqual(data.data, { text: '[REDACTED]' });
});

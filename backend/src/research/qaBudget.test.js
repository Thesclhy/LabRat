import test from 'node:test';
import assert from 'node:assert/strict';
import { createQaBudget } from './qaBudget.js';
import { countQaInput, estimateDeepSeekInput, reportedQaUsage } from './qaTokenCount.js';

const endpoint = 'https://api.anthropic.com/v1/messages';
const request = { model: 'claude-sonnet-4-5', max_tokens: 4000, system: 'Use the tool definitions.',
  messages: [{ role: 'user', content: 'Catalyst ZnO 催化剂 −12.5 °C 🔬\n'.repeat(2500) }],
  tools: [{ name: 'read_page', input_schema: { type: 'object', properties: { page: { type: 'integer' } } } }] };

test('19,999 used tokens and a large byte body fit after model-specific input counting', async () => {
  let sent = 0, counted;
  const budget = createQaBudget({ previous: { inputTokens: 19000, outputTokens: 999 } });
  await budget.wrapFetch(async (url, init) => {
    if (url.endsWith('/count_tokens')) { counted = JSON.parse(init.body); return Response.json({ input_tokens: 18000 }); }
    sent += 1; return Response.json({ usage: { input_tokens: 18020, output_tokens: 700 } });
  }, { provider: 'anthropic' })(endpoint, { body: JSON.stringify(request), headers: { 'x-api-key': 'fixture' } });
  assert.equal(sent, 1); assert.ok(Buffer.byteLength(JSON.stringify(request)) > 60000);
  assert.deepEqual(counted.tools, request.tools); assert.deepEqual(counted.messages, request.messages);
  assert.equal(counted.model, request.model); assert.equal(counted.max_tokens, undefined);
  const usage = budget.stats(); assert.equal(usage.inputTokens + usage.outputTokens, 38719);
  assert.equal(usage.measurements[0].inputReservation, 19156); assert.equal(usage.countRequests, 1);
  assert.equal(usage.reservedTokens, 0); assert.ok(!JSON.stringify(usage).includes('催化剂'));
});

test('actual and predicted exhaustion block, unknown generation usage remains reserved across retries', async () => {
  let generated = 0;
  const fetcher = async (url) => url.endsWith('/count_tokens') ? Response.json({ input_tokens: 38000 })
    : (generated += 1, Response.json({}));
  const budget = createQaBudget({ previous: { inputTokens: 19999 } });
  await assert.rejects(budget.wrapFetch(fetcher, { provider: 'anthropic' })(endpoint, { body: JSON.stringify(request) }), { code: 'qa_token_limit' });
  assert.equal(generated, 0);
  const unknown = createQaBudget();
  await assert.rejects(unknown.wrapFetch(async (url) => {
    if (url.endsWith('/count_tokens')) return Response.json({ input_tokens: 8000 });
    throw new Error('uncertain connection');
  }, { provider: 'anthropic' })(endpoint, { body: JSON.stringify(request) }));
  assert.equal(unknown.stats().reservedTokens, 12656); assert.equal(unknown.stats().unknownUsageRequests, 1);
  const retry = createQaBudget({ previous: unknown.stats() });
  await retry.wrapFetch(async () => Response.json({ usage: { prompt_tokens: 500, completion_tokens: 10 } }), { provider: 'deepseek' })(
    'https://api.deepseek.com/chat/completions', { body: JSON.stringify({ model: 'deepseek-v4-pro', messages: [], max_tokens: 4000 }) });
  assert.equal(retry.stats().requests, 2); assert.equal(retry.stats().reservedTokens, 12656);
  assert.equal(retry.stats().inputTokens, 500); assert.equal(retry.stats().measurements.length, 2);
  const overrun = createQaBudget();
  await assert.rejects(overrun.wrapFetch(async () => Response.json({ usage: { prompt_tokens: 60001, completion_tokens: 5 } }))(
    'https://invalid.example', { body: '{}' }), { code: 'qa_token_limit' });
});

test('cache accounting is provider-specific and invalid usage never clears a reservation', () => {
  assert.deepEqual(reportedQaUsage({ usage: { input_tokens: 10, output_tokens: 3,
    cache_creation_input_tokens: 20, cache_read_input_tokens: 70 } }, 'anthropic'), { input: 100, output: 3 });
  assert.deepEqual(reportedQaUsage({ usage: { prompt_tokens: 100, completion_tokens: 20,
    prompt_cache_hit_tokens: 70, prompt_cache_miss_tokens: 30,
    completion_tokens_details: { reasoning_tokens: 18 }, cache_read_input_tokens: 70 } }, 'deepseek'), { input: 100, output: 20 });
  assert.equal(reportedQaUsage({ usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: -1 } }, 'anthropic'), null);
  assert.equal(reportedQaUsage({ usage: { prompt_tokens: 100 } }, 'deepseek'), null);
});

test('unavailable or malformed count responses stop before generation, cancellation remains distinct', async () => {
  for (const response of [Response.json({}, { status: 503 }), Response.json({ input_tokens: -1 }), Response.json({ input_tokens: '10' })]) {
    let calls = 0; const budget = createQaBudget();
    await assert.rejects(budget.wrapFetch(async () => { calls += 1; return response; }, { provider: 'anthropic' })(endpoint, { body: JSON.stringify(request) }), { code: 'qa_token_count_unavailable' });
    assert.equal(calls, 1); assert.equal(budget.stats().requests, 0); assert.equal(budget.stats().reservedTokens, 0);
  }
  const cancelled = new AbortController();
  const budget = createQaBudget({ signal: cancelled.signal });
  await assert.rejects(budget.wrapFetch(async () => { cancelled.abort(); throw new Error('abort'); }, { provider: 'anthropic' })(endpoint, { body: JSON.stringify(request) }), { code: 'qa_cancelled' });
});

test('offline estimates distinguish text scripts and retain tool/schema framing', async () => {
  const ascii = estimateDeepSeekInput({ messages: [{ content: 'Catalyst stability '.repeat(100) }] });
  const chinese = estimateDeepSeekInput({ messages: [{ content: '催化剂稳定性'.repeat(100) }] });
  assert.ok(chinese > 600); assert.ok(ascii > 500); assert.ok(estimateDeepSeekInput(request) > ascii);
  await assert.rejects(countQaInput({ provider: 'deepseek', request: { model: 'unverified-model' } }), { code: 'qa_token_count_unavailable' });
});

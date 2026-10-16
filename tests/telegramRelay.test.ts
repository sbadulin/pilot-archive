import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import relay from '../deploy/telegram-relay/worker.ts';

const env = {REPORTS_RELAY_KEY: 'a'.repeat(48), TELEGRAM_BOT_TOKEN: '123:test', TELEGRAM_CHAT_ID: '-1001234'};
const request = (body: object, authorized = true) => new Request('https://relay.test/send', {
  method: 'POST', headers: {'content-type': 'application/json', ...(authorized ? {authorization: `Bearer ${env.REPORTS_RELAY_KEY}`} : {})},
  body: JSON.stringify(body),
});

test('relay rejects unauthorized and malformed requests before contacting Telegram', async () => {
  assert.equal((await relay.fetch(request({text: 'Первый Пилот: тест'}, false), env)).status, 401);
  assert.equal((await relay.fetch(request({text: 'unrelated text'}), env)).status, 400);
  assert.equal((await relay.fetch(request({text: 'Первый Пилот:' + 'x'.repeat(3500)}), env)).status, 400);
});

test('relay fixes the destination and does not return Telegram secrets', async (context) => {
  let sent: any;
  context.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    sent = JSON.parse(String(options.body));
    return Response.json({ok: true, result: {message_id: 42}});
  });
  const response = await relay.fetch(request({text: 'Первый Пилот: тест', chat_id: '-999'}), env);
  assert.equal(sent.chat_id, env.TELEGRAM_CHAT_ID);
  assert.deepEqual(await response.json(), {ok: true, message_id: 42});
});

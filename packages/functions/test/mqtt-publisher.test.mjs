import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, mock, test } from 'node:test';

let client;
let options;
let setupError;
class FakeClient extends EventEmitter {
  connect = mock.fn();
  publish = mock.fn();
  end = mock.fn();
}
const createClient = mock.fn((input) => {
  if (setupError) throw setupError;
  options = input;
  client = new FakeClient();
  return client;
});
mock.module('mqtt', { namedExports: { connect: createClient } });
const { publishTelemetry, MQTT_HOST, MQTT_TOPIC } =
  await import('../dist/mqtt-publisher.js');
const credentials = () => ({ key: 'test-key', cert: 'test-cert' });

beforeEach(() => {
  createClient.mock.resetCalls();
  setupError = undefined;
});

test('publishes every bitmask 0 through 15, only succeeding after PUBACK', async () => {
  for (let active = 0; active <= 15; active++) {
    let completed = false;
    const pending = publishTelemetry(active, credentials).then((result) => {
      completed = true;
      return result;
    });
    assert.equal(client.connect.mock.callCount(), 1);
    assert.deepEqual(options, {
      protocol: 'mqtts',
      hostname: MQTT_HOST,
      port: 8883,
      servername: MQTT_HOST,
      clientId: 'client2-authn-ID',
      username: 'client2-authn-ID',
      protocolVersion: 5,
      clean: true,
      manualConnect: true,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
      rejectUnauthorized: true,
      key: 'test-key',
      cert: 'test-cert',
    });
    client.emit('connect', {});
    await Promise.resolve();
    assert.equal(completed, false);
    const [topic, payload, publishOptions, acknowledge] =
      client.publish.mock.calls[0].arguments;
    assert.equal(topic, 'edge/telemetry/fromcloud/command');
    assert.equal(payload, `{"active":${active}}`);
    assert.deepEqual(publishOptions, { qos: 1, retain: false });
    acknowledge(null, { cmd: 'puback', reasonCode: 0 });
    assert.deepEqual(await pending, { ok: true, active, topic: MQTT_TOPIC });
    assert.deepEqual(client.end.mock.calls[0].arguments, [true]);
    // Late transport events must not turn success into a new failure.
    client.emit('error', new Error('private provider detail'));
    client.emit('close');
    assert.equal(client.end.mock.callCount(), 1);
  }
});

test('rejects noninteger/out-of-range input before reading secrets or connecting', async () => {
  const read = mock.fn(credentials);
  for (const active of [-1, 16, 255, 0.5, NaN, Infinity, '1', null, undefined]) {
    const result = await publishTelemetry(active, read);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_ACTIVE');
  }
  assert.equal(read.mock.callCount(), 0);
  assert.equal(createClient.mock.callCount(), 0);
});

test('reports missing secrets without leaking getter errors', async () => {
  for (const read of [
    () => ({ key: '', cert: 'certificate' }),
    () => ({ key: 'key', cert: '  ' }),
    () => { throw new Error('sensitive-secret-value'); },
  ]) {
    const result = await publishTelemetry(1, read);
    assert.equal(result.code, 'SECRET_NOT_CONFIGURED');
    assert.doesNotMatch(JSON.stringify(result), /sensitive-secret-value/);
  }
  assert.equal(createClient.mock.callCount(), 0);
});

test('handles a synchronous TLS setup failure safely', async () => {
  setupError = new Error('sensitive-key-value');
  const result = await publishTelemetry(1, credentials);
  assert.equal(result.code, 'MQTT_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /sensitive-key-value/);
});

test('does not treat a rejected publish acknowledgement as success', async () => {
  for (const error of [null, new Error('private broker response')]) {
    const pending = publishTelemetry(1, credentials);
    client.emit('connect', {});
    client.publish.mock.calls[0].arguments[3](
      error, { cmd: 'puback', reasonCode: 135 }
    );
    const result = await pending;
    assert.equal(result.code, 'MQTT_REJECTED');
    assert.doesNotMatch(JSON.stringify(result), /private broker response/);
    assert.equal(client.end.mock.callCount(), 1);
  }
});

test('reports transport and authentication errors and closes connections', async () => {
  for (const [event, detail, code] of [
    ['error', new Error('private transport detail'), 'MQTT_FAILED'],
    ['error', Object.assign(new Error('private auth detail'), { code: 135 }), 'MQTT_REJECTED'],
    ['close', undefined, 'MQTT_FAILED'],
    ['disconnect', { reasonCode: 142 }, 'MQTT_REJECTED'],
  ]) {
    const pending = publishTelemetry(1, credentials);
    client.emit(event, detail);
    const result = await pending;
    assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /private/);
    assert.equal(client.publish.mock.callCount(), 0);
    assert.equal(client.end.mock.callCount(), 1);
  }
});

test('times out both connection and unacknowledged publish at exactly 15s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const connected of [false, true]) {
    let completed = false;
    const pending = publishTelemetry(1, credentials).then((result) => {
      completed = true;
      return result;
    });
    if (connected) client.emit('connect', {});
    t.mock.timers.tick(14_999);
    await Promise.resolve();
    assert.equal(completed, false);
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.code, 'MQTT_TIMEOUT');
    assert.match(result.message, /Delivery is uncertain/);
    assert.equal(client.end.mock.callCount(), 1);
  }
});
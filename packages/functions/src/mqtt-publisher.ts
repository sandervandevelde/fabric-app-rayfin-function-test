import { connect, type MqttClient } from 'mqtt';

export const MQTT_HOST =
  'ais-demo-weu-mqtt-egns.westeurope-1.ts.eventgrid.azure.net';
export const MQTT_TOPIC = 'edge/telemetry/fromcloud/command';
const CLIENT_ID = 'client2-authn-ID';
const TIMEOUT_MS = 15_000;

export type MqttPublishResult =
  | { ok: true; active: number; topic: string }
  | {
      ok: false;
      code:
        | 'INVALID_ACTIVE'
        | 'SECRET_NOT_CONFIGURED'
        | 'MQTT_REJECTED'
        | 'MQTT_TIMEOUT'
        | 'MQTT_FAILED';
      message: string;
    };

type FailureCode = Extract<MqttPublishResult, { ok: false }>['code'];

const MESSAGES: Record<FailureCode, string> = {
  INVALID_ACTIVE: 'Active must be a whole number from 0 to 15.',
  SECRET_NOT_CONFIGURED:
    'The MQTT client certificate or private key is missing. Configure both Rayfin secrets.',
  MQTT_REJECTED:
    'The broker rejected the connection or publish. Check the registered certificate thumbprint and topic permissions.',
  MQTT_TIMEOUT:
    'No broker acknowledgement arrived before the timeout. Delivery is uncertain; check the subscriber before sending again.',
  MQTT_FAILED:
    'The MQTT connection failed. Check broker connectivity and certificate configuration. Delivery may be uncertain.',
};

function failure(code: FailureCode): MqttPublishResult {
  console.error(`publishMqttTelemetry: ${code}`);
  return { ok: false, code, message: MESSAGES[code] };
}

export async function publishTelemetry(
  active: number,
  readCredentials: () => { key: string; cert: string }
): Promise<MqttPublishResult> {
  if (!Number.isInteger(active) || active < 0 || active > 15) {
    return failure('INVALID_ACTIVE');
  }

  let credentials: { key: string; cert: string };
  try {
    credentials = readCredentials();
    if (!credentials.key?.trim() || !credentials.cert?.trim()) {
      return failure('SECRET_NOT_CONFIGURED');
    }
  } catch {
    // Secret getters throw when a declared secret has not been supplied.
    return failure('SECRET_NOT_CONFIGURED');
  }

  return new Promise<MqttPublishResult>((resolve) => {
    let client: MqttClient | undefined;
    let settled = false;
    const timeout = setTimeout(
      () => finish(failure('MQTT_TIMEOUT')),
      TIMEOUT_MS
    );

    function finish(result: MqttPublishResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // Acknowledgement has completed before success; don't leave a session alive.
      client?.end(true);
      resolve(result);
    }

    try {
      client = connect({
        protocol: 'mqtts',
        hostname: MQTT_HOST,
        port: 8883,
        servername: MQTT_HOST,
        clientId: CLIENT_ID,
        username: CLIENT_ID,
        protocolVersion: 5,
        clean: true,
        manualConnect: true,
        reconnectPeriod: 0,
        connectTimeout: 10_000,
        rejectUnauthorized: true,
        key: credentials.key,
        cert: credentials.cert,
      });
      client.on('error', (error) => {
        if (settled) return;
        const rejected =
          'code' in error &&
          typeof error.code === 'number' &&
          error.code >= 128;
        finish(failure(rejected ? 'MQTT_REJECTED' : 'MQTT_FAILED'));
      });
      client.on('close', () => {
        if (!settled) finish(failure('MQTT_FAILED'));
      });
      client.on('disconnect', () => {
        if (!settled) finish(failure('MQTT_REJECTED'));
      });
      client.once('connect', () => {
        if (settled || !client) return;
        client.publish(
          MQTT_TOPIC,
          JSON.stringify({ active }),
          { qos: 1, retain: false },
          (error, packet) => {
            if (settled) return;
            const rejected =
              packet?.cmd === 'puback' &&
              packet.reasonCode !== undefined &&
              packet.reasonCode >= 128;
            if (error || rejected) {
              finish(failure('MQTT_REJECTED'));
            } else {
              finish({ ok: true, active, topic: MQTT_TOPIC });
            }
          }
        );
      });
      client.connect();
    } catch {
      finish(failure('MQTT_FAILED'));
    }
  });
}
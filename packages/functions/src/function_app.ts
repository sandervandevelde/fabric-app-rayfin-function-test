import {
  UserDataFunctions,
  type RayfinContext,
} from '@microsoft/fabric-user-data-functions';
import type { UniversalAppSchema } from '@rayfin-app/shared';
import { publishTelemetry, type MqttPublishResult } from './mqtt-publisher.js';

const udf = new UserDataFunctions();

udf.func(
  'publishMqttTelemetry',
  async (
    ctx: RayfinContext<UniversalAppSchema>,
    active: number
  ): Promise<MqttPublishResult> =>
    publishTelemetry(active, () => ({
      key: ctx.Secrets.MQTT_CLIENT2_AUTHN_ID_KEY,
      cert: ctx.Secrets.MQTT_CLIENT2_AUTHN_ID_PEM,
    })),
  []
);

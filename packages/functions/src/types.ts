/**
 * Function schema types for RayfinClient.
 *
 * AUTO-GENERATED — do not edit manually.
 * Re-generated automatically when function source files change.
 *
 * If this file is not updating automatically, run:
 *   rayfin dev functions apply
 *
 * The schema is a closed object type: only the function names listed
 * below are accepted by RayfinClient.functions.<name>.invoke(...).
 * Adding, renaming, or changing the signature of a udf.func() call
 * regenerates this file and surfaces type errors at every consumer.
 *
 * IMPORTANT: This file must NOT import any Node.js packages — it is
 * resolved by the frontend app's TypeScript compiler.
 */

export type AppFunctionsSchema = {
  publishMqttTelemetry: {
    input: { active: number };
    output: { ok: true; active: number; topic: string } | { ok: false; code: 'INVALID_ACTIVE' | 'SECRET_NOT_CONFIGURED' | 'MQTT_REJECTED' | 'MQTT_TIMEOUT' | 'MQTT_FAILED'; message: string };
  };
};

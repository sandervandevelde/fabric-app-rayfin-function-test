//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { useRef, useState } from 'react';
import { Check, Circle, LoaderCircle, Moon, Power, Radio, Sun } from 'lucide-react';
import { useAppTheme } from '@/hooks/use-theme';
import { getRayfinClient } from '@/lib/rayfin-client';

const LIGHTS = [
  { name: 'Blue', bit: 1, color: 'bg-light-blue text-light-label', lamp: 'bg-light-blue' },
  { name: 'Green', bit: 2, color: 'bg-light-green text-light-label', lamp: 'bg-light-green' },
  { name: 'Yellow', bit: 4, color: 'bg-light-yellow text-light-ink', lamp: 'bg-light-yellow' },
  { name: 'Red', bit: 8, color: 'bg-light-red text-light-label', lamp: 'bg-light-red' },
];

function App() {
  const { isDark, toggleTheme } = useAppTheme();
  const [active, setActive] = useState(0);
  const [acknowledged, setAcknowledged] = useState<number>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  }>();
  const selected = LIGHTS.filter((light) => (active & light.bit) !== 0);

  async function publish(value: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setActive(value);
    setPending(true);
    setNotice(undefined);
    try {
      const client = await getRayfinClient();
      const result = await client.functions.publishMqttTelemetry.invoke(
        { active: value },
        { timeoutMs: 25_000 }
      );
      if (result.ok) setAcknowledged(result.active);
      setNotice(
        result.ok
          ? {
              kind: 'success',
              message: `Broker acknowledged {"active":${result.active}}. Device state is not reported.`,
            }
          : { kind: 'error', message: result.message }
      );
    } catch {
      setNotice({
        kind: 'error',
        message:
          'The function could not be reached or completed. Check your sign-in and function service. Delivery may be uncertain; check the subscriber before sending again.',
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <main className="min-h-full bg-background p-600 font-base text-foreground sm:p-800">
      <div className="mx-auto max-w-5xl space-y-800">
        <header className="flex items-start justify-between gap-400">
          <div>
            <p className="flex items-center gap-200 font-monospace text-200 text-primary">
              <Radio className="icon-size-200" aria-hidden="true" />
              EDGE / LIGHT CONTROL
            </p>
            <h1 className="mt-200 font-heading text-hero-800 leading-hero-800 font-semibold">
              MQTT telemetry
            </h1>
            <p className="mt-300 text-300 text-muted-foreground">
              Four colors. Every combination. One touch.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="rounded-lg border p-300 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            {isDark ? <Sun className="icon-size-300" /> : <Moon className="icon-size-300" />}
          </button>
        </header>
        <section aria-labelledby="tower-heading" className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <div className="grid md:grid-cols-3">
            <aside className="flex flex-col items-center justify-center gap-600 bg-muted p-800">
              <p className="font-monospace text-200 text-muted-foreground">REQUESTED COMBINATION</p>
              <div aria-label="Towerlight preview" className="rounded-3xl bg-tower-housing p-300 shadow-lg">
                {[...LIGHTS].reverse().map((light) => (
                  <div
                    key={light.bit}
                    data-testid={`lamp-${light.name.toLowerCase()}`}
                    data-lit={Boolean(active & light.bit)}
                    className={`my-200 flex h-lamp w-tower items-center justify-center rounded-xl text-200 font-semibold transition-colors ${active & light.bit ? light.color : 'bg-tower-idle text-light-label'}`}
                  >
                    {light.name}
                  </div>
                ))}
              </div>
              <div className="text-center">
                <p className="font-heading text-500 font-semibold">{selected.length ? selected.map((light) => light.name).join(' + ') : 'All off'}</p>
                <p className="mt-200 text-200 text-muted-foreground">Preview only · Device state unknown</p>
              </div>
            </aside>
            <div className="space-y-600 p-600 sm:p-800 md:col-span-2">
              <div>
                <h2 id="tower-heading" className="font-heading text-600 font-semibold">Towerlight control</h2>
                <p id="toggle-help" className="mt-200 text-300 text-muted-foreground">
                  Tap a color to toggle it. Each tap immediately sends the full combination to the towerlight.
                </p>
              </div>
              <div role="group" aria-label="Light colors" aria-describedby="toggle-help" className="grid grid-cols-2 gap-400">
                {LIGHTS.map((light) => {
                  const enabled = Boolean(active & light.bit);
                  return (
                    <button
                      key={light.bit}
                      type="button"
                      aria-label={light.name}
                      aria-pressed={enabled}
                      disabled={pending}
                      onClick={() => void publish(active ^ light.bit)}
                      className={`flex flex-col gap-400 rounded-2xl border-2 p-500 text-left transition-shadow hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60 ${light.color} ${enabled ? 'border-current ring-2 ring-ring ring-offset-2 ring-offset-card' : 'border-transparent'}`}
                    >
                      <span className="flex w-full items-center justify-between gap-200">
                        <span className="font-heading text-500 font-semibold">{light.name}</span>
                        {enabled ? <Check className="icon-size-300" aria-hidden="true" /> : <Circle className="icon-size-300" aria-hidden="true" />}
                      </span>
                      <span className="text-200">{enabled ? 'Selected' : 'Not selected'} · {light.bit}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => void publish(0)}
                className="flex w-full items-center justify-center gap-200 rounded-xl border bg-secondary p-400 text-300 font-semibold text-secondary-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60"
              >
                <Power className="icon-size-200" aria-hidden="true" /> All off
              </button>
              <div className="flex flex-wrap items-center justify-between gap-300 rounded-xl bg-muted p-400">
                <div>
                  <p className="text-200 text-muted-foreground">Requested message</p>
                  <pre aria-label="Message preview" className="mt-100 font-monospace text-400">{JSON.stringify({ active })}</pre>
                </div>
                <p className="text-200 text-muted-foreground">
                  Last broker ACK: <span className="font-monospace">{acknowledged ?? 'None'}</span>
                </p>
              </div>
              {pending && (
                <p role="status" className="flex items-center gap-200 text-300">
                  <LoaderCircle aria-hidden="true" className="icon-size-200 motion-safe:animate-spin" />
                  Sending command. Waiting for broker acknowledgement…
                </p>
              )}
              {notice && (
                <div className="space-y-300">
                  <p
                    role={notice.kind === 'error' ? 'alert' : 'status'}
                    className={`break-words text-300 ${notice.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
                  >
                    {notice.message}
                  </p>
                  {notice.kind === 'error' && (
                    <button type="button" onClick={() => void publish(active)} disabled={pending} className="rounded-lg border p-300 text-300 font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                      Resend requested combination
                    </button>
                  )}
                </div>
              )}
              <p className="text-200 text-muted-foreground">
                Blue = 1 · Green = 2 · Yellow = 4 · Red = 8. Add colors together: blue + green = 3; all four = 15.
                No command is sent when this page opens.
              </p>
            </div>
          </div>
        </section>
        <details className="rounded-xl border bg-card p-400 text-200 text-muted-foreground">
          <summary className="cursor-pointer rounded-sm text-300 font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring">Connection details</summary>
          <dl className="mt-400 space-y-300">
            <div><dt>Broker · TLS / 8883</dt><dd className="break-all font-monospace">ais-demo-weu-mqtt-egns.westeurope-1.ts.eventgrid.azure.net</dd></div>
            <div><dt>Topic</dt><dd className="break-all font-monospace">edge/telemetry/fromcloud/command</dd></div>
            <div><dt>Certificate identity</dt><dd className="font-monospace">client2-authn-ID</dd></div>
          </dl>
          <p className="mt-400">QoS 1 · Not retained · No automatic retries. Broker acceptance does not confirm device processing. Credentials stay server-side.</p>
        </details>
      </div>
    </main>
  );
}

export default App;

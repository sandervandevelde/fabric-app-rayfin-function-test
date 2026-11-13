//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { invoke, getClient } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('@/lib/rayfin-client', () => ({ getRayfinClient: getClient }));

import App from '@/App';

describe('App', () => {
  beforeEach(() => {
    invoke.mockReset();
    getClient.mockReset();
    getClient.mockResolvedValue({ functions: { publishMqttTelemetry: { invoke } } });
    invoke.mockImplementation(async ({ active }: { active: number }) => ({
      ok: true, active, topic: 'edge/telemetry/fromcloud/command',
    }));
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
  });

  it('starts with an unsent all-off preview and unknown physical state', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'MQTT telemetry' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Towerlight control' })).toBeVisible();
    expect(screen.getByText('Preview only · Device state unknown')).toBeVisible();
    expect(screen.getByLabelText('Message preview')).toHaveTextContent('{"active":0}');
    expect(screen.getByText(/Last broker ACK:/)).toHaveTextContent('None');
    for (const color of ['Blue', 'Green', 'Yellow', 'Red']) {
      expect(screen.getByRole('button', { name: color })).toHaveAttribute('aria-pressed', 'false');
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([['Blue', 1], ['Green', 2], ['Yellow', 4], ['Red', 8]] as const)(
    '%s immediately publishes bit %i and updates the preview', async (color, active) => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: color }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`{"active":${active}}`));
    expect(invoke).toHaveBeenCalledExactlyOnceWith({ active }, { timeoutMs: 25_000 });
    expect(screen.getByRole('button', { name: color })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(`lamp-${color.toLowerCase()}`)).toHaveAttribute('data-lit', 'true');
  });

  it('combines colors, removes individual bits, and sends all off', async () => {
    render(<App />);
    for (const [color, active] of [
      ['Blue', 1], ['Green', 3], ['Yellow', 7], ['Red', 15], ['Green', 13],
      ['All off', 0],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: color }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`{"active":${active}}`));
      expect(invoke).toHaveBeenLastCalledWith({ active }, { timeoutMs: 25_000 });
      expect(screen.getByLabelText('Message preview')).toHaveTextContent(`{"active":${active}}`);
    }
    expect(invoke).toHaveBeenCalledTimes(6);
    for (const color of ['Blue', 'Green', 'Yellow', 'Red']) {
      expect(screen.getByRole('button', { name: color })).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('supports all 16 bitmask combinations through the buttons', async () => {
    render(<App />);
    let previous = 0;
    for (let index = 0; index < 16; index++) {
      // Gray-code order changes only one light between successive combinations.
      const active = index ^ (index >> 1);
      const changed = previous ^ active;
      const color = [{ bit: 1, name: 'Blue' }, { bit: 2, name: 'Green' },
        { bit: 4, name: 'Yellow' }, { bit: 8, name: 'Red' }].find((item) => item.bit === changed);
      fireEvent.click(screen.getByRole('button', { name: color?.name ?? 'All off' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`{"active":${active}}`));
      expect(invoke).toHaveBeenLastCalledWith({ active }, { timeoutMs: 25_000 });
      previous = active;
    }
    expect(invoke).toHaveBeenCalledTimes(16);
  });

  it('blocks overlapping commands until the acknowledgement arrives', async () => {
    let complete: ((result: { ok: true; active: number; topic: string }) => void) | undefined;
    invoke.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    render(<App />);
    const button = screen.getByRole('button', { name: 'Blue' });
    fireEvent.click(button);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Green' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'All off' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for broker acknowledgement');
    expect(screen.getByText(/Last broker ACK:/)).toHaveTextContent('None');
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    expect(invoke).toHaveBeenCalledTimes(1);
    await act(async () => complete?.({ ok: true, active: 1, topic: 'edge/telemetry/fromcloud/command' }));
    expect(button).toBeEnabled();
  });

  it('shows uncertain delivery, does not claim success or auto-retry, and allows explicit resend', async () => {
    invoke.mockResolvedValue({ ok: false, code: 'MQTT_TIMEOUT', message: 'Delivery is uncertain. Check the subscriber.' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Delivery is uncertain');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(/Last broker ACK:/)).toHaveTextContent('None');
    expect(screen.getByLabelText('Message preview')).toHaveTextContent('{"active":8}');
    expect(invoke).toHaveBeenCalledTimes(1);
    invoke.mockResolvedValue({ ok: true, active: 8, topic: 'edge/telemetry/fromcloud/command' });
    fireEvent.click(screen.getByRole('button', { name: 'Resend requested combination' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('{"active":8}'));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith({ active: 8 }, { timeoutMs: 25_000 });
  });

  it('retains the last acknowledged value separately from a failed request', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
    await screen.findByText('Broker acknowledged {"active":1}. Device state is not reported.');
    invoke.mockResolvedValue({ ok: false, code: 'MQTT_FAILED', message: 'Delivery uncertain.' });
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    await screen.findByRole('alert');
    expect(screen.getByText(/Last broker ACK:/)).toHaveTextContent('1');
    expect(screen.getByLabelText('Message preview')).toHaveTextContent('{"active":3}');
  });

  it.each(['configuration', 'invocation'])('sanitizes %s failures and allows another attempt', async (source) => {
    if (source === 'configuration') getClient.mockRejectedValue(new Error('private details'));
    else invoke.mockRejectedValue(new Error('private details'));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Yellow' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Check your sign-in and function service');
    expect(alert).not.toHaveTextContent('private details');
    expect(screen.getByRole('button', { name: 'Yellow' })).toBeEnabled();
  });

  it('supports the light/dark toggle', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement).toHaveClass('dark');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});

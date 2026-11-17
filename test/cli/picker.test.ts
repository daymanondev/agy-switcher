import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { pickProfileInteractive, renderPickerFrame } from '../../src/cli/picker.ts';
import type { ProfileListEntry } from '../../src/cli/format.ts';

describe('Interactive Picker', () => {
  const entries: ProfileListEntry[] = [
    { alias: 'pro1', email: 'pro1@example.com', isActive: true, isExpired: false, tier: 'Google AI Pro' },
    { alias: 'pro2', email: 'pro2@example.com', isActive: false, isExpired: false, tier: 'Google AI Pro' },
  ];

  it('renders picker frame highlighting selected cursor index', () => {
    const frame = renderPickerFrame(entries, 1);
    assert.match(frame, />\s+pro2/);
    assert.match(frame, /\* active/);
    assert.match(frame, /\[Enter\] Switch/);
  });

  it('handles down arrow + enter to select second profile', async () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
    const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
    (stdin as unknown as { isTTY: boolean; isRaw: boolean; setRawMode: (v: boolean) => void }).isTTY = true;
    (stdin as unknown as { isRaw: boolean }).isRaw = false;
    (stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode = () => {};
    (stdout as unknown as { isTTY: boolean }).isTTY = true;

    const promise = pickProfileInteractive(entries, { stdin, stdout });
    stdin.emit('keypress', '', { name: 'down', ctrl: false, meta: false, shift: false, sequence: '\x1b[B' });
    stdin.emit('keypress', '\r', { name: 'return', ctrl: false, meta: false, shift: false, sequence: '\r' });

    const res = await promise;
    assert.deepEqual(res, { action: 'select', alias: 'pro2' });
  });

  it('handles b shortcut for best and q for cancel', async () => {
    const makeStreams = () => {
      const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
      const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
      (stdin as unknown as { isTTY: boolean; isRaw: boolean; setRawMode: (v: boolean) => void }).isTTY = true;
      (stdin as unknown as { isRaw: boolean }).isRaw = false;
      (stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode = () => {};
      (stdout as unknown as { isTTY: boolean }).isTTY = true;
      return { stdin, stdout };
    };

    const s1 = makeStreams();
    const p1 = pickProfileInteractive(entries, s1);
    s1.stdin.emit('keypress', 'b', { name: 'b', ctrl: false, meta: false, shift: false, sequence: 'b' });
    assert.deepEqual(await p1, { action: 'best' });

    const s2 = makeStreams();
    const p2 = pickProfileInteractive(entries, s2);
    s2.stdin.emit('keypress', 'q', { name: 'q', ctrl: false, meta: false, shift: false, sequence: 'q' });
    assert.deepEqual(await p2, { action: 'cancel' });
  });
});

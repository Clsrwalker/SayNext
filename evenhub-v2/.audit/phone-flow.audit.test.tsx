// @vitest-environment jsdom
// Read-only audit reproductions: assertions intentionally describe observed bugs.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import App from '../src/App';
import { loadStoredConversationSettings } from '../src/settings-storage';

const bridge = vi.hoisted(() => ({
  render: vi.fn(async () => {}),
  setAudioEnabled: vi.fn(async () => true),
  dispose: vi.fn(),
}));
vi.mock('../src/glasses-bridge', () => ({
  connectGlassBridge: vi.fn(async () => ({
    bridge: {}, ...bridge, updateTextContainer: vi.fn(async () => true),
  })),
}));
class Socket {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 0; binaryType = 'blob'; sent: string[] = [];
  onopen: any; onmessage: any; onclose: any; onerror: any;
  constructor() { Socket.instances.push(this); }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; }
  disconnect() { this.readyState = 3; this.onclose?.(new Event('close')); }
  open() { this.readyState = 1; this.onopen?.(new Event('open')); }
  receive(type: string, payload: object) {
    this.onmessage?.({ data: JSON.stringify({ type, payload, protocolVersion: 'evenhub-v2.1', timestamp: new Date().toISOString() }) });
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const response = (data: any, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data });
const blankBootstrap = () => ({ settingsSource: 'default', prenotes: [], conversations: [] });
const record = (id: string) => ({ id, title: 'Record ' + id, startedAt: '2026-09-04T12:00:00Z', endedAt: '2026-09-04T12:01:00Z', durationMs: 60000, summaryStatus: 'ready' });
const detail = (id: string) => ({ conversation: record(id), transcript: [], cues: [], summary: { status: 'ready', title: '', overview: 'Summary ' + id, keyPoints: [], actionItems: [] } });

beforeEach(() => {
  localStorage.clear(); Socket.instances = []; vi.clearAllMocks();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn(async () => response(blankBootstrap())));
  vi.stubGlobal('requestAnimationFrame', (cb: any) => { cb(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('REPRO: Back hides an active conversation, Start cannot return, and mic stays enabled', async () => {
  const ui = render(<App />);
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0];
  await act(async () => socket.open());
  fireEvent.click(ui.getByRole('button', { name: /开始/ }));
  await act(async () => socket.receive('conversation_started', { conversationId: 'active-1' }));
  await act(async () => socket.receive('audio_status', { audioStatus: 'listening' }));
  await waitFor(() => expect(bridge.setAudioEnabled).toHaveBeenCalledWith(true, 'glasses'));
  const disablesBefore = bridge.setAudioEnabled.mock.calls.filter(c => c[0] === false).length;
  fireEvent.click(ui.getByRole('button', { name: 'Back' }));
  fireEvent.click(ui.getByRole('button', { name: /开始/ }));
  expect(ui.queryByRole('button', { name: /结束/ })).toBeNull();
  expect(ui.queryByRole('button', { name: /暂停/ })).toBeNull();
  expect(bridge.setAudioEnabled.mock.calls.filter(c => c[0] === false)).toHaveLength(disablesBefore);
  expect(socket.sent.filter(s => JSON.parse(s).type === 'conversation_end')).toHaveLength(0);
});

test('REPRO: starting before bootstrap omits saved selected notes', async () => {
  const boot = deferred<any>();
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/bootstrap') ? boot.promise : Promise.resolve(response({}))));
  const ui = render(<App />);
  await act(async () => Socket.instances[0].open());
  fireEvent.click(ui.getByRole('button', { name: /开始/ }));
  const start = Socket.instances[0].sent.map(s => JSON.parse(s)).find(s => s.type === 'conversation_start');
  expect(start.payload.selectedPrenoteIds).toEqual([]);
  await act(async () => boot.resolve(response({ ...blankBootstrap(), prenotes: [{ id: 'pn-1', title: 'Saved note', text: 'Remember this fact', selected: true, files: [] }] })));
  expect(Socket.instances[0].sent.map(s => JSON.parse(s)).filter(s => s.type === 'conversation_start')).toHaveLength(1);
  expect(ui.getByRole('button', { name: '预备笔记' })).toBeTruthy();
});

test('REPRO: failed bootstrap is hidden on home and does not reload on ready', async () => {
  const fetchMock = vi.fn(async () => response({}, false));
  vi.stubGlobal('fetch', fetchMock);
  const ui = render(<App />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); Socket.instances[0].open(); Socket.instances[0].receive('ready', {}); });
  expect(ui.container.textContent).not.toMatch(/bootstrap_failed|失败|重试/);
  expect(fetchMock.mock.calls.filter(c => String(c[0]).includes('/bootstrap'))).toHaveLength(1);
});

test('REPRO: older history response overrides the record selected most recently', async () => {
  const old = deferred<any>();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/bootstrap')) return Promise.resolve(response({ ...blankBootstrap(), conversations: [record('A'), record('B')] }));
    if (url.endsWith('/A')) return old.promise;
    if (url.endsWith('/B')) return Promise.resolve(response(detail('B')));
    return Promise.resolve(response({}));
  }));
  const ui = render(<App />);
  await waitFor(() => expect(ui.getByRole('button', { name: /Record A/ })).toBeTruthy());
  fireEvent.click(ui.getByRole('button', { name: /Record A/ }));
  fireEvent.click(ui.getByRole('button', { name: 'Back' }));
  fireEvent.click(ui.getByRole('button', { name: /Record B/ }));
  await waitFor(() => expect(ui.container.textContent).toContain('Summary B'));
  await act(async () => old.resolve(response(detail('A'))));
  expect(ui.container.textContent).toContain('Summary A');
  expect(ui.container.textContent).not.toContain('Summary B');
});

test('REPRO: localStorage read denial throws during initial settings load', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  expect(() => loadStoredConversationSettings({ voiceInput: 'glasses', language: 'english', glassContent: { aiCue: true, transcript: true }, autoPopup: true, cueDuration: 'forever' })).toThrow('denied');
});

test('REPRO: ending while disconnected is forgotten and restored session blocks Start on home', async () => {
  const ui = render(<App />);
  const first = Socket.instances[0];
  await act(async () => first.open());
  fireEvent.click(ui.getByRole('button', { name: /开始/ }));
  await act(async () => first.receive('conversation_started', { conversationId: 'active-offline' }));
  await act(async () => first.disconnect());
  fireEvent.click(ui.getByRole('button', { name: /结束/ }));
  expect(ui.queryByRole('button', { name: /开始/ })).toBeTruthy();
  await waitFor(() => expect(Socket.instances).toHaveLength(2), { timeout: 3000 });
  const second = Socket.instances[1];
  await act(async () => {
    second.open();
    second.receive('ready', { conversationId: 'active-offline', conversationStatus: 'active', audioStatus: 'listening' });
  });
  fireEvent.click(ui.getByRole('button', { name: /开始/ }));
  expect(ui.queryByRole('button', { name: /结束/ })).toBeNull();
  expect(second.sent.map(s => JSON.parse(s)).filter(s => ['conversation_start', 'conversation_end'].includes(s.type))).toHaveLength(0);
});

test('REPRO: queued Start on reconnect is cancelled by idle ready and never starts audio', async () => {
  const ui = render(<App />);
  const first = Socket.instances[0];
  await act(async () => { first.open(); first.receive('ready', { conversationStatus: 'idle', audioStatus: 'idle' }); });
  await act(async () => first.disconnect());
  fireEvent.click(ui.getByRole('button', { name: /开始/ }));
  await waitFor(() => expect(Socket.instances).toHaveLength(2), { timeout: 3000 });
  const second = Socket.instances[1];
  await act(async () => {
    second.open();
    second.receive('ready', { conversationStatus: 'idle', audioStatus: 'idle' });
    second.receive('conversation_started', { conversationId: 'queued-new' });
  });
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  expect(second.sent.map(s => JSON.parse(s)).filter(s => s.type === 'conversation_start')).toHaveLength(1);
  expect(second.sent.map(s => JSON.parse(s)).filter(s => s.type === 'audio_start')).toHaveLength(0);
  expect(ui.queryByRole('button', { name: /开始/ })).toBeTruthy();
  expect(ui.queryByRole('button', { name: /结束/ })).toBeNull();
});

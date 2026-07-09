// Phase 0: verify the socket path works. Real mode-select wiring lands in Phase 5.
const ws = new WebSocket(`ws://${location.host}`);
ws.addEventListener('open', () => {
  console.log('[ws] connected');
  ws.send(JSON.stringify({ type: 'PING' }));
});
ws.addEventListener('message', (e) => console.log('[ws] received:', e.data));

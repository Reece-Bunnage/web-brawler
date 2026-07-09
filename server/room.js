// Lobby/session state. Phase 0 stub: log and echo so the socket path can be
// verified end-to-end; real lobby logic lands in Phase 9.
export class Room {
  constructor() {
    this.sockets = new Set();
  }

  addConnection(socket) {
    this.sockets.add(socket);
    socket.send(JSON.stringify({ type: 'HELLO', message: 'web-brawler server' }));
    socket.on('message', (data) => {
      console.log(`[ws] message: ${data}`);
      socket.send(data.toString());
    });
    socket.on('close', () => this.sockets.delete(socket));
  }
}

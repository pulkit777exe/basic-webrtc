/**
 * Minimal WebSocket signaling relay for the browser rig.
 *
 * Deliberately tiny and dependency-free: the point of these tests is the real
 * WebRTC stack (SDP, ICE, encoders, media), not the production backend, which
 * needs Postgres and Redis. This relays every frame to the other peers in the
 * room and tracks when each peer has published its answer, so the test can wait
 * on real negotiation rather than sleeping.
 *
 * Run standalone:  bun run frontend/e2e/signaling-server.ts [port]
 */
import { WebSocketServer, type WebSocket } from 'ws';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8787);

interface Client {
  socket: WebSocket;
  id: string;
  roomId: string;
  /** Frames received, so a test can assert the signaling path really ran. */
  relayed: number;
}

const rooms = new Map<string, Set<Client>>();

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (socket: WebSocket) => {
  const client: Client = { socket, id: '', roomId: '', relayed: 0 };
  // Without this, a test that only listens never gets unsubscribed.
  socket.on('error', () => socket.close());

  socket.on('message', (raw: Buffer) => {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }

    if (frame.type === 'join') {
      client.id = String(frame.peerId ?? '');
      client.roomId = String(frame.roomId ?? 'e2e');
      let room = rooms.get(client.roomId);
      if (!room) {
        room = new Set();
        rooms.set(client.roomId, room);
      }
      room.add(client);
      // Tell the newcomer who is already here, and the others about it.
      for (const peer of room) {
        if (peer === client) continue;
        if (peer.id) send(socket, { type: 'peer-joined', peerId: peer.id });
        send(peer.socket, { type: 'peer-joined', peerId: client.id });
      }
      return;
    }

    if (frame.type === 'leave') {
      for (const peer of rooms.get(client.roomId) ?? []) {
        send(peer.socket, { type: 'peer-left', peerId: client.id });
      }
      rooms.get(client.roomId)?.delete(client);
      return;
    }

    // Everything else is a signal. Honour the `to` field like the real backend
    // does: broadcasting instead delivers peer's answer to the *third* peer in
    // the room, which then tries to apply it to a connection that is already
    // stable. Only unaddressed frames are broadcast.
    const room = rooms.get(client.roomId);
    if (!room) return;
    const to = typeof frame.to === 'string' ? frame.to : null;
    for (const peer of room) {
      if (peer === client) continue;
      if (to !== null && peer.id !== to) continue;
      peer.relayed += 1;
      send(peer.socket, { ...frame, from: client.id });
    }
  });

  socket.on('close', () => {
    const room = rooms.get(client.roomId);
    if (!room) return;
    for (const peer of room) send(peer.socket, { type: 'peer-left', peerId: client.id });
    room.delete(client);
    if (room.size === 0) rooms.delete(client.roomId);
  });
});

console.log(`[signaling] ws://127.0.0.1:${PORT}`);

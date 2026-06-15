import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';

let io: SocketServer | null = null;

async function emitOnlineCount(eventId: string) {
  if (!io) return;
  const room = 'event:' + eventId;
  const sockets = await io.in(room).fetchSockets();
  io.to(room).emit('online-count', sockets.length);
}

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGINS?.split(',') || [],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    const joinedEvents = new Set<string>();

    socket.on('join-event', (eventId: string) => {
      socket.join('event:' + eventId);
      joinedEvents.add(eventId);
      emitOnlineCount(eventId);
    });

    socket.on('leave-event', (eventId: string) => {
      socket.leave('event:' + eventId);
      joinedEvents.delete(eventId);
      emitOnlineCount(eventId);
    });

    socket.on('disconnect', () => {
      for (const eventId of joinedEvents) {
        emitOnlineCount(eventId);
      }
    });
  });

  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

export function emitToEvent(eventId: string, event: string, data: any): void {
  if (io) {
    io.to('event:' + eventId).emit(event, data);
  }
}
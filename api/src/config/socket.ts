import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { verifyAccessToken } from '../utils/crypto';

let io: SocketServer | null = null;

// audit: LOW-048 / INFO-013 — Resolution robuste des origines CORS : trim +
// filtrage des entrees vides (une virgule finale ou des espaces produisaient
// sinon des origines erronees, bloquant ou ouvrant la config silencieusement).
// TODO(audit:LOW-048): factoriser cet util avec index.ts (hors perimetre de
// cette unite) pour eviter la duplication.
function resolveCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function emitOnlineCount(eventId: string) {
  if (!io) return;
  const room = 'event:' + eventId;
  const sockets = await io.in(room).fetchSockets();
  io.to(room).emit('online-count', sockets.length);
}

export function initSocketServer(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      // audit: LOW-048 / INFO-013 — origines CORS nettoyees (trim + filter)
      origin: resolveCorsOrigins(),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  // audit: MED-013 — Authentification au handshake. On verifie un access token
  // JWT fourni dans handshake.auth.token (ou header Authorization). En mode
  // DEGRADE documente : si aucun token n'est fourni, la connexion est acceptee
  // mais marquee non authentifiee (les clients participants PWA actuels n'ont
  // pas encore de token — cf CRIT-001). Un token PRESENT mais INVALIDE est en
  // revanche rejete (on ne tolere pas un token forge).
  // TODO(audit:MED-013): une fois l'auth participant (token signe au join)
  // implementee cote serveur (CRIT-001), rendre le token obligatoire et
  // valider l'appartenance du participant a l'event sur join-event.
  io.use((socket, next) => {
    const rawAuth = (socket.handshake.auth && (socket.handshake.auth as any).token) || undefined;
    const headerAuth = socket.handshake.headers.authorization;
    const token = rawAuth || (headerAuth && headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : undefined);

    if (!token) {
      (socket.data as any).authenticated = false;
      return next(); // mode degrade documente
    }

    try {
      const decoded = verifyAccessToken(token);
      (socket.data as any).authenticated = true;
      (socket.data as any).userId = decoded.userId;
      return next();
    } catch {
      // token present mais invalide/expire -> on refuse
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const joinedEvents = new Set<string>();

    socket.on('join-event', (eventId: string) => {
      // audit: MED-013 — Validation d'acces a l'event sur join-event.
      // On rejette les eventId manifestement invalides (anti-pollution du
      // online-count et anti-enumeration grossiere). La verification fine
      // d'ownership/participation reste a brancher avec l'auth participant
      // (TODO MED-013 ci-dessus) sans casser les clients existants.
      if (typeof eventId !== 'string' || eventId.length === 0 || eventId.length > 64) {
        return;
      }
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
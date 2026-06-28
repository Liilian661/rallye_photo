import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import http from 'http';
import compression from 'compression';

dotenv.config();

import { testConnection } from './config/database';
import { initSocketServer } from './config/socket';

// Routes
import authRoutes        from './routes/auth';
import eventRoutes       from './routes/events';
import challengeRoutes   from './routes/challenges';
import participantRoutes from './routes/participants';
import submissionRoutes  from './routes/submissions';
import leaderboardRoutes from './routes/leaderboard';
import galleryRoutes     from './routes/gallery';
import adminRoutes       from './routes/admin';
import photoRoutes       from './routes/photos';
import teamRoutes        from './routes/teams';
import webhookRoutes     from './routes/webhooks';
import affiliateRoutes   from './routes/affiliates';
import paymentRoutes     from './routes/payments';

const app    = express();
const server = http.createServer(app);
const PORT   = parseInt(process.env.PORT || '3001');

// Trust first proxy (nginx) for correct client IP in rate limiting
app.set('trust proxy', 1);

// Init Socket.io
app.use(compression());
initSocketServer(server);

// ── IMPORTANT: raw body for Stripe webhook MUST come before express.json() ──
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

// Middleware
app.use(helmet());

// audit: LOW-048 — trim + filtre des origines vides (virgule finale / espaces)
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('combined'));

// audit: MED-016 — express.json global NE DOIT PAS reparser /webhooks/stripe
// (body deja consomme en raw par express.raw ci-dessus). Sans cette exclusion,
// req.body pourrait etre ecrase et casser la verification de signature Stripe.
const jsonParser = express.json({ limit: '1mb' });
app.use((req, res, next) => {
  if (req.path === '/webhooks/stripe') return next();
  return jsonParser(req, res, next);
});
// audit: LOW-050 — limite de taille explicite + extended:false (API JSON-only,
// reduit la surface de prototype pollution de qs).
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// Routes
app.use('/auth',      authRoutes);
app.use('/webhooks',  webhookRoutes);
app.use('/affiliates', affiliateRoutes);
app.use('/payments',  paymentRoutes);
app.use('/events',    galleryRoutes);   // AVANT eventRoutes: /:eventId/gallery matche avant /:id
app.use('/events',    eventRoutes);
app.use('/',          challengeRoutes);
app.use('/',          participantRoutes);
app.use('/',          submissionRoutes);
app.use('/',          leaderboardRoutes);
app.use('/admin',     adminRoutes);
app.use('/photos',    photoRoutes);
app.use('/',          teamRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Route non trouvee' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// Start
async function start() {
  await testConnection();

  server.listen(PORT, () => {
    console.log('Rallye Photo API running on port ' + PORT);
    console.log('WebSocket ready');
    console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

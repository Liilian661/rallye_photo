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
import authRoutes from './routes/auth';
import eventRoutes from './routes/events';
import challengeRoutes from './routes/challenges';
import participantRoutes from './routes/participants';
import submissionRoutes from './routes/submissions';
import leaderboardRoutes from './routes/leaderboard';
import galleryRoutes from './routes/gallery';
import adminRoutes from './routes/admin';
import photoRoutes from './routes/photos';
import teamRoutes from './routes/teams';

const app = express();
const server = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3001');

// Init Socket.io
app.use(compression());
initSocketServer(server);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || [],
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/events', galleryRoutes);  // AVANT eventRoutes: /:eventId/gallery matche avant /:id
app.use('/events', eventRoutes);
app.use('/', challengeRoutes);
app.use('/', participantRoutes);
app.use('/', submissionRoutes);
app.use('/', leaderboardRoutes);
app.use('/admin', adminRoutes);
app.use('/photos', photoRoutes);
app.use('/', teamRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

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
import express, { NextFunction, Request, Response, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initializeSocket } from './lib/socket';
import { prisma } from './lib/prisma';
import { getTrustProxyHops } from './lib/config';
import { buildUserRoutes } from './routes/users.routes';
import { buildStationRoutes } from './routes/stations.routes';
import { buildSatellitesRoutes } from './routes/satellites.routes';
import { buildPacketRoutes } from './routes/packets.routes';
import { buildStatsRoutes } from './routes/stats.routes';
import buildAuthRoutes from './routes/auth.routes';


const app = express();
const port = Number(process.env.PORT ?? 8432);
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
const { server, io } = initializeSocket(app);

// Behind CloudFront (+WAF) -> ELB -> nginx (3 hops): trust that many so req.ip is the real client IP
app.set('trust proxy', getTrustProxyHops());
app.disable('x-powered-by');

// HSTS is handled by CloudFront; this is a JSON API so CSP is not needed here
app.use(helmet({ strictTransportSecurity: false, contentSecurityPolicy: false }));

app.use(cors({
  origin: frontendUrl,
  credentials: true,
}));

app.use(express.json({ limit: '100kb' }));

// Defense in depth only: WAF rate-based rules are the primary protection
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});

app.get('/', (_req, res) => {
  res.send('Hello, World!');
});

const health = async (_req: Request, res: Response): Promise<Response> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: 'ok' });
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
};

const api = Router();
api.get('/health', health);
api.use('/users', buildUserRoutes());
api.use('/satellites', buildSatellitesRoutes());
api.use('/stations', buildStationRoutes());
api.use('/packets', buildPacketRoutes());
api.use('/stats', buildStatsRoutes());
api.use('/auth', authLimiter, buildAuthRoutes());

app.get('/health', health);
app.use('/api', api);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

// Last-resort handler: never leak stack traces or internal errors to the client
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ message: 'Malformed JSON body' });
  }
  if (typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body too large' });
  }
  console.error('[API] Unhandled error', error);
  return res.status(500).json({ message: 'Internal error' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[API] Service running at http://localhost:${port}`);
});

const shutdown = (signal: string): void => {
  console.log(`[API] ${signal} received, shutting down`);
  io.close();
  server.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

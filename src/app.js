import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import employeeRoutes from './routes/employees.js';
import documentRoutes from './routes/documents.js';
import onboardingRoutes from './routes/onboarding.js';
import contractRoutes from './routes/contracts.js';
import payrollRoutes from './routes/payroll.js';
import talentRoutes from './routes/talent.js';
import analyticsRoutes from './routes/analytics.js';
import systemRoutes from './routes/system.js';
import activityRoutes from './routes/activity.js';
import assistantRoutes from './routes/assistant.js';
import selfServiceRoutes from './routes/selfService.js';
import profileRoutes from './routes/profile.js';
import storageRoutes from './routes/storage.js';
import { notFound, errorHandler } from './middleware/error.js';

const app = express();
app.set('trust proxy', env.trustProxy);

const allowedOrigins = new Set(env.clientUrls);
const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    // Requests without Origin are allowed for health checks, curl, PM2, etc.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin không được phép: ${origin}`));
  }
};

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

app.get('/', (req, res) => res.json({
  ok: true,
  service: 'TH79 HRM API',
  frontend: env.clientUrl,
  health: '/api/health',
  message: 'Backend API đang hoạt động độc lập trên VPS.'
}));
app.get('/api', (req, res) => res.json({ ok: true, service: 'TH79 HRM API', health: '/api/health', session: '/api/auth/session', auth: '/api/auth/me' }));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  service: 'TH79 HRM API',
  time: new Date().toISOString(),
  storage: { provider: 'cloudinary', configured: env.cloudinaryConfigured }
}));

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120 }), authRoutes);
app.use('/api', requireAuth);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/talent', talentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/self-service', selfServiceRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/storage', storageRoutes);

app.use(notFound);
app.use(errorHandler);
export default app;

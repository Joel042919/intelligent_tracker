import cors from 'cors';
import express from 'express';
import { blocksRouter } from './routes/blocks.js';
import { dailyRouter } from './routes/daily.js';
import { evaluationRouter } from './routes/evaluation.js';
import { healthRouter } from './routes/health.js';
import { projectsRouter } from './routes/projects.js';
import { reentryRouter } from './routes/reentry.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api', healthRouter);
  app.use('/api', projectsRouter);
  app.use('/api', dailyRouter);
  app.use('/api', blocksRouter);
  app.use('/api', reentryRouter);
  app.use('/api', evaluationRouter);

  return app;
}

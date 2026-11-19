import { Router } from 'express';
import { pool } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    const result = await pool.query<{ now: string }>('SELECT NOW()::text AS now');
    res.json({ ok: true, dbTime: result.rows[0]?.now });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

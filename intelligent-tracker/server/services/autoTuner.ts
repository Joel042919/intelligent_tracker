import type { PoolClient } from 'pg';

export interface AutoTuneSuggestion {
  type: 'LOW_DIMENSION_SCORE' | 'RECURRING_FRICTION';
  message: string;
  target: string;
}

/**
 * SystemAutoTunerService: analiza patrones recientes (últimos 3+ días)
 * en daily_dimension_scores y friction_catalog para sugerir ajustes estructurales.
 */
export async function analyzeAutoTuneSuggestions(
  client: PoolClient,
  userId: string
): Promise<AutoTuneSuggestion[]> {
  const suggestions: AutoTuneSuggestion[] = [];

  const lowDims = await client.query<{ name: string; avg_score: string; cnt: string }>(
    `SELECT ed.name, ROUND(AVG(dds.score), 1)::text AS avg_score, COUNT(*)::text AS cnt
     FROM daily_dimension_scores dds
     JOIN daily_evaluations de ON de.id = dds.daily_evaluation_id
     JOIN daily_logs dl ON dl.id = de.daily_log_id
     JOIN evaluation_dimensions ed ON ed.id = dds.dimension_id
     WHERE dl.user_id = $1
       AND dl.log_date >= CURRENT_DATE - INTERVAL '7 days'
     GROUP BY ed.id, ed.name
     HAVING COUNT(*) >= 3 AND AVG(dds.score) < 3`,
    [userId]
  );

  for (const row of lowDims.rows) {
    suggestions.push({
      type: 'LOW_DIMENSION_SCORE',
      target: row.name,
      message: `La dimensión "${row.name}" promedia ${row.avg_score}/5 en ${row.cnt} días recientes. Considera reducir la dosis mínima o ajustar el trigger.`,
    });
  }

  const frictions = await client.query<{
    label: string;
    default_adjustment_rule: string | null;
    cnt: string;
  }>(
    `SELECT fc.label, fc.default_adjustment_rule, COUNT(*)::text AS cnt
     FROM time_blocks tb
     JOIN daily_logs dl ON dl.id = tb.daily_log_id
     JOIN friction_catalog fc ON fc.id = tb.friction_id
     WHERE dl.user_id = $1
       AND dl.log_date >= CURRENT_DATE - INTERVAL '7 days'
     GROUP BY fc.id, fc.label, fc.default_adjustment_rule
     HAVING COUNT(*) >= 3`,
    [userId]
  );

  for (const f of frictions.rows) {
    suggestions.push({
      type: 'RECURRING_FRICTION',
      target: f.label,
      message: `Fricción recurrente "${f.label}" (${f.cnt} veces): ${f.default_adjustment_rule ?? 'Ajustar entorno y triggers.'}`,
    });
  }

  return suggestions;
}

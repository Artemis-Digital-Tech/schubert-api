import type { IngestBillingPlan } from '../auth/caller-context.util';

/** Janela deslizante de 7 dias para quotas semanais. */
export const IMPORT_QUOTA_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Limites semanais de importação de música por plano. */
export const WEEKLY_IMPORT_LIMITS: Record<IngestBillingPlan, number> = {
  free: 3,
  starter: 5,
  pro: 10,
};

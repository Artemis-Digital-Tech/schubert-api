import type { IngestBillingPlan } from '../auth/caller-context.util';

/** Janela deslizante dos planos pagos: 30 dias. */
export const IMPORT_QUOTA_WINDOW_DAYS = 30;
export const IMPORT_QUOTA_WINDOW_MS =
  IMPORT_QUOTA_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * `lifetime`: conta todas as importações do utilizador, sem renovação.
 * `rolling`: conta as importações dos últimos `IMPORT_QUOTA_WINDOW_DAYS` dias.
 */
export type ImportQuotaWindow = 'lifetime' | 'rolling';

export type ImportQuotaRule = { limit: number; window: ImportQuotaWindow };

/** Limites de importação de música por plano (espelhar em `cifra.ai-web/lib/billing/plan-catalog.ts`). */
export const IMPORT_QUOTA_RULES: Record<IngestBillingPlan, ImportQuotaRule> = {
  free: { limit: 2, window: 'lifetime' },
  starter: { limit: 12, window: 'rolling' },
  pro: { limit: 35, window: 'rolling' },
};

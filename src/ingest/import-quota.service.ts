import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

import type {
  IngestBillingPlan,
  IngestCallerLogPayload,
} from '../auth/caller-context.util';
import { resolveIngestBillingPlan } from '../auth/caller-context.util';
import { IngestJobsService } from '../ingest-jobs/ingest-jobs.service';
import {
  IMPORT_QUOTA_RULES,
  IMPORT_QUOTA_WINDOW_DAYS,
  IMPORT_QUOTA_WINDOW_MS,
  type ImportQuotaWindow,
} from './import-quota.constants';

export type ImportQuotaStatus = {
  plan: IngestBillingPlan;
  limit: number;
  used: number;
  remaining: number;
  /** `lifetime` = cota total sem renovação; `rolling` = janela deslizante de `windowDays`. */
  window: ImportQuotaWindow;
  /** Dias da janela deslizante; `null` na cota vitalícia. */
  windowDays: number | null;
  /** Quando a importação mais antiga da janela expira (liberta um slot). Sempre `null` na cota vitalícia. */
  nextSlotAt: string | null;
};

@Injectable()
export class ImportQuotaService {
  constructor(private readonly ingestJobs: IngestJobsService) {}

  async getStatus(
    ownerSub: string,
    plan: IngestBillingPlan,
  ): Promise<ImportQuotaStatus> {
    const { limit, window } = IMPORT_QUOTA_RULES[plan];
    const since =
      window === 'rolling'
        ? new Date(Date.now() - IMPORT_QUOTA_WINDOW_MS)
        : null;
    const used = await this.ingestJobs.countImports(ownerSub, since);
    const remaining = Math.max(0, limit - used);

    let nextSlotAt: string | null = null;
    if (window === 'rolling' && used >= limit) {
      const oldest = await this.ingestJobs.findOldestImport(ownerSub, since);
      if (oldest) {
        nextSlotAt = new Date(
          oldest.getTime() + IMPORT_QUOTA_WINDOW_MS,
        ).toISOString();
      }
    }

    return {
      plan,
      limit,
      used,
      remaining,
      window,
      windowDays: window === 'rolling' ? IMPORT_QUOTA_WINDOW_DAYS : null,
      nextSlotAt,
    };
  }

  async assertCanImport(
    caller: IngestCallerLogPayload,
  ): Promise<ImportQuotaStatus> {
    const ownerSub = caller.auth0Sub?.trim();
    if (!ownerSub || ownerSub === '(sem utilizador no request)') {
      throw new ForbiddenException({
        code: 'not_authenticated',
        message: 'Inicie sessão para importar música.',
      });
    }

    const plan = resolveIngestBillingPlan(caller);
    const status = await this.getStatus(ownerSub, plan);
    if (status.remaining <= 0) {
      throw new HttpException(
        {
          code: 'import_quota_exceeded',
          message: this.quotaExceededMessage(plan, status.limit),
          ...status,
          nextSlotAt: status.nextSlotAt,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return status;
  }

  private quotaExceededMessage(plan: IngestBillingPlan, limit: number): string {
    if (IMPORT_QUOTA_RULES[plan].window === 'lifetime') {
      return `Já usou as ${limit} músicas incluídas no plano Gratuito. Assine um plano para importar mais.`;
    }
    const planLabel = plan === 'pro' ? 'Pro' : 'Starter';
    return `Atingiu o limite de ${limit} músicas em ${IMPORT_QUOTA_WINDOW_DAYS} dias do plano ${planLabel}.`;
  }
}

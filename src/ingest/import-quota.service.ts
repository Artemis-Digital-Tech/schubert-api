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
  IMPORT_QUOTA_WINDOW_MS,
  WEEKLY_IMPORT_LIMITS,
} from './import-quota.constants';

export type ImportQuotaStatus = {
  plan: IngestBillingPlan;
  limit: number;
  used: number;
  remaining: number;
  windowDays: number;
  /** Quando a importação mais antiga da janela expira (liberta um slot). */
  nextSlotAt: string | null;
};

@Injectable()
export class ImportQuotaService {
  constructor(private readonly ingestJobs: IngestJobsService) {}

  weeklyLimit(plan: IngestBillingPlan): number {
    return WEEKLY_IMPORT_LIMITS[plan];
  }

  async getStatus(
    ownerSub: string,
    plan: IngestBillingPlan,
  ): Promise<ImportQuotaStatus> {
    const limit = this.weeklyLimit(plan);
    const used = await this.ingestJobs.countWeeklyImports(ownerSub);
    const remaining = Math.max(0, limit - used);
    const oldest = await this.ingestJobs.findOldestWeeklyImport(ownerSub);
    const nextSlotAt =
      used >= limit && oldest
        ? new Date(oldest.getTime() + IMPORT_QUOTA_WINDOW_MS).toISOString()
        : null;

    return {
      plan,
      limit,
      used,
      remaining,
      windowDays: 7,
      nextSlotAt,
    };
  }

  async assertCanImport(caller: IngestCallerLogPayload): Promise<ImportQuotaStatus> {
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
    const planLabel =
      plan === 'pro' ? 'Pro' : plan === 'starter' ? 'Starter' : 'Gratuito';
    return `Atingiu o limite de ${limit} importações por semana do plano ${planLabel}.`;
  }
}

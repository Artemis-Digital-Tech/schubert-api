import { HttpException } from '@nestjs/common';

import type { IngestCallerLogPayload } from '../auth/caller-context.util';
import type { IngestJobsService } from '../ingest-jobs/ingest-jobs.service';
import { ImportQuotaService } from './import-quota.service';

// O schema Mongoose de `IngestJob` não carrega sob ts-jest; o serviço só precisa do token de DI.
jest.mock('../ingest-jobs/ingest-jobs.service', () => ({
  IngestJobsService: class {},
}));

function caller(billingPlan: string): IngestCallerLogPayload {
  return {
    auth0Sub: 'auth0|user-1',
    billingPlan,
    auth0ApiPermissions: [],
    appPermissions: [],
    scope: null,
    billingPlanSource: 'jwt',
  };
}

function serviceWith(used: number, oldest: Date | null = null) {
  const jobs = {
    countImports: jest
      .fn<Promise<number>, [string, Date | null]>()
      .mockResolvedValue(used),
    findOldestImport: jest.fn().mockResolvedValue(oldest),
  };
  const service = new ImportQuotaService(jobs as unknown as IngestJobsService);
  return { service, jobs };
}

describe('ImportQuotaService', () => {
  it('conta todas as importações do plano Gratuito, sem janela', async () => {
    const { service, jobs } = serviceWith(1);
    const status = await service.getStatus('auth0|user-1', 'free');

    expect(jobs.countImports).toHaveBeenCalledWith('auth0|user-1', null);
    expect(status).toMatchObject({
      limit: 2,
      used: 1,
      remaining: 1,
      window: 'lifetime',
      windowDays: null,
      nextSlotAt: null,
    });
  });

  it('bloqueia a terceira importação do plano Gratuito e não promete renovação', async () => {
    const { service, jobs } = serviceWith(2);

    await expect(
      service.assertCanImport(caller('free')),
    ).rejects.toBeInstanceOf(HttpException);
    expect(jobs.findOldestImport).not.toHaveBeenCalled();
  });

  it('usa janela de 30 dias nos planos pagos e calcula o próximo slot', async () => {
    const oldest = new Date('2026-10-01T00:00:00.000Z');
    const { service, jobs } = serviceWith(35, oldest);
    const status = await service.getStatus('auth0|user-1', 'pro');

    const since = jobs.countImports.mock.calls[0][1] as Date;
    expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(
      30 * 24 * 60 * 60 * 1000 - 1000,
    );
    expect(status).toMatchObject({
      limit: 35,
      remaining: 0,
      window: 'rolling',
      windowDays: 30,
      nextSlotAt: '2026-10-31T00:00:00.000Z',
    });
  });

  it('aplica 12 músicas por janela ao Starter', async () => {
    const { service } = serviceWith(5);
    const status = await service.getStatus('auth0|user-1', 'starter');
    expect(status).toMatchObject({ limit: 12, remaining: 7 });
  });
});

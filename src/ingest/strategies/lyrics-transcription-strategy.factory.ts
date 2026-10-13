import { Inject, Injectable } from '@nestjs/common';

import type { IngestBillingPlan } from '../../auth/caller-context.util';
import type { ILyricsTranscriptionProvider } from '../domain/lyrics-transcription.port';
import { ASSEMBLYAI_TRANSCRIPTION_PROVIDER } from '../ingest.tokens';

@Injectable()
export class LyricsTranscriptionStrategyFactory {
  constructor(
    @Inject(ASSEMBLYAI_TRANSCRIPTION_PROVIDER)
    private readonly assemblyai: ILyricsTranscriptionProvider,
  ) {}

  /** Estratégia única: transcrição sempre via AssemblyAI. */
  select(plan: IngestBillingPlan): ILyricsTranscriptionProvider {
    void plan;
    return this.assemblyai;
  }
}

import type { TranscriptionLyricSegmentSubdoc } from '../../tracks/schemas/track.schema';

export type TranscriptionOptions = {
  /** Código ISO (ex.: `pt`); sem valor, o provedor deteta o idioma. */
  language?: string;
  /** Palavras esperadas (ex.: letra do LRCLIB) para melhorar o reconhecimento. */
  wordBoost?: string[];
};

/** Transcrição de letra com alinhamento temporal (AssemblyAI e futuros provedores). */
export interface ILyricsTranscriptionProvider {
  transcribe(
    audioPath: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionLyricSegmentSubdoc[]>;
}

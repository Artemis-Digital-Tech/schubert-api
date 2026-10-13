import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { fetch } from 'undici';

import type { TranscriptionLyricSegmentSubdoc } from '../../tracks/schemas/track.schema';
import type {
  ILyricsTranscriptionProvider,
  TranscriptionOptions,
} from '../domain/lyrics-transcription.port';
import { assemblyaiSentencesToLyricSegments } from '../mappers/assemblyai-sentences.mapper';

const LANG_LABEL: Record<string, string> = {
  en: 'english',
  pt: 'portuguese',
  es: 'spanish',
};

type TranscriptStatus = 'queued' | 'processing' | 'completed' | 'error';

@Injectable()
export class AssemblyaiLyricsTranscriptionProvider implements ILyricsTranscriptionProvider {
  private readonly logger = new Logger(
    AssemblyaiLyricsTranscriptionProvider.name,
  );

  constructor(private readonly config: ConfigService) {}

  async transcribe(
    audioPath: string,
    options?: TranscriptionOptions,
  ): Promise<TranscriptionLyricSegmentSubdoc[]> {
    const apiKey = this.config.get<string>('ASSEMBLYAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'ASSEMBLYAI_API_KEY não configurada — transcrição AssemblyAI indisponível.',
      );
    }

    const base = (
      this.config.get<string>('ASSEMBLYAI_BASE')?.trim() ||
      'https://api.assemblyai.com'
    ).replace(/\/$/, '');
    const speechModel = this.config
      .get<string>('ASSEMBLYAI_SPEECH_MODEL')
      ?.trim();
    const pollMs = Math.max(
      1000,
      parseInt(
        this.config.get<string>('ASSEMBLYAI_POLL_MS')?.trim() || '3000',
        10,
      ) || 3000,
    );
    const lang = (options?.language || 'en').toLowerCase().slice(0, 2);
    const languageLabel = LANG_LABEL[lang] || lang || 'unknown';

    const buf = await readFile(audioPath);
    const up = await fetch(`${base}/v2/upload`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: buf,
    });
    const upBody = (await up.json().catch(() => ({}))) as {
      upload_url?: string;
      error?: string;
    };
    if (!up.ok) {
      throw new ServiceUnavailableException(
        `AssemblyAI upload: ${up.status} ${upBody.error ?? up.statusText}`,
      );
    }
    if (!upBody.upload_url)
      throw new ServiceUnavailableException(
        'AssemblyAI: resposta sem upload_url',
      );

    const request: Record<string, unknown> = {
      audio_url: upBody.upload_url,
      punctuate: true,
      format_text: true,
    };
    if (lang.length === 2) request.language_code = lang;
    else request.language_detection = true;
    if (speechModel) request.speech_model = speechModel;

    const cr = await fetch(`${base}/v2/transcript`, {
      method: 'POST',
      headers: { authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const crBody = (await cr.json().catch(() => ({}))) as {
      id?: string;
      error?: string;
    };
    if (!cr.ok) {
      throw new ServiceUnavailableException(
        `AssemblyAI transcript: ${cr.status} ${crBody.error ?? cr.statusText}`,
      );
    }
    const transcriptId = crBody.id;
    if (!transcriptId)
      throw new ServiceUnavailableException(
        'AssemblyAI: resposta sem transcript id',
      );

    for (;;) {
      const tr = await fetch(`${base}/v2/transcript/${transcriptId}`, {
        headers: { authorization: apiKey },
      });
      const task = (await tr.json().catch(() => ({}))) as {
        status?: TranscriptStatus;
        error?: string;
      };
      if (!tr.ok) {
        throw new ServiceUnavailableException(`AssemblyAI poll: ${tr.status}`);
      }
      if (task.status === 'error') {
        throw new ServiceUnavailableException(
          `AssemblyAI transcript erro: ${task.error ?? 'desconhecido'}`,
        );
      }
      if (task.status === 'completed') break;
      await new Promise((r) => setTimeout(r, pollMs));
    }

    const sr = await fetch(`${base}/v2/transcript/${transcriptId}/sentences`, {
      headers: { authorization: apiKey },
    });
    if (!sr.ok)
      throw new ServiceUnavailableException(
        `AssemblyAI sentences: ${sr.status}`,
      );
    const rawJson = await sr.json().catch(() => null);

    const segments = assemblyaiSentencesToLyricSegments(rawJson, languageLabel);
    this.logger.log(
      `AssemblyAI: ${segments.length} segmento(s), transcript=${transcriptId}`,
    );
    return segments;
  }
}

import type {
  TranscriptionLyricSegmentSubdoc,
  TranscriptionLyricWordSubdoc,
} from '../../tracks/schemas/track.schema';

export type AsrWord = { text?: string; start?: number; end?: number };

export type LineBreakOptions = {
  /** Pausa entre palavras (s) que encerra uma frase musical. */
  pauseSec?: number;
  /** Pausa menor (s) que encerra a linha quando a palavra anterior termina com pontuação. */
  punctuatedPauseSec?: number;
  /** Tamanho máximo da linha (caracteres) — legibilidade no celular. */
  maxChars?: number;
};

const DEFAULTS: Required<LineBreakOptions> = {
  pauseSec: 0.7,
  punctuatedPauseSec: 0.25,
  maxChars: 42,
};

/** AssemblyAI devolve tempos em milissegundos; o Track guarda segundos. */
function msToSec(ms: unknown): number {
  const n = Number(ms);
  return Number.isFinite(n) ? n / 1000 : 0;
}

/**
 * Palavras da transcrição (com tempo) → linhas da cifra. Numa música não há pontuação fiável:
 * as linhas seguem as **pausas da voz** (fim de frase musical), com limite de tamanho para
 * leitura no celular. Pontuação só ajuda a cortar em pausas mais curtas.
 */
export function assemblyaiWordsToLyricSegments(
  raw: AsrWord[] | null | undefined,
  languageLabel: string,
  options: LineBreakOptions = {},
): TranscriptionLyricSegmentSubdoc[] {
  const o = { ...DEFAULTS, ...options };
  const words: TranscriptionLyricWordSubdoc[] = (Array.isArray(raw) ? raw : [])
    .map((w) => {
      const text = String(w?.text ?? '').trim();
      const start = msToSec(w?.start);
      const end = Math.max(start, msToSec(w?.end ?? w?.start));
      return {
        word: text,
        start,
        end,
        syllables: [{ syllable: text || ' ', start, end }],
      };
    })
    .filter((w) => w.word.length > 0)
    .sort((a, b) => a.start - b.start);

  const segments: TranscriptionLyricSegmentSubdoc[] = [];
  let cur: TranscriptionLyricWordSubdoc[] = [];
  const flush = () => {
    if (!cur.length) return;
    segments.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word).join(' '),
      language: languageLabel,
      words: cur,
    });
    cur = [];
  };

  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.start! - prev.end!;
      const punctuated = /[.,;:!?…]$/.test(prev.word);
      const lineLen =
        cur.reduce((n, x) => n + x.word.length + 1, 0) + w.word.length;
      if (
        gap >= o.pauseSec ||
        (punctuated && gap >= o.punctuatedPauseSec) ||
        lineLen > o.maxChars
      ) {
        flush();
      }
    }
    cur.push(w);
  }
  flush();
  return segments;
}

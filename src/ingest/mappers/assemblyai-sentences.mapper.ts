import type {
  TranscriptionLyricSegmentSubdoc,
  TranscriptionLyricWordSubdoc,
} from '../../tracks/schemas/track.schema';

type AssemblyaiWord = { text?: string; start?: number; end?: number };
type AssemblyaiSentence = {
  text?: string;
  start?: number;
  end?: number;
  words?: AssemblyaiWord[];
};

/** AssemblyAI devolve tempos em milissegundos; o Track guarda segundos. */
function msToSec(ms: unknown): number {
  const n = Number(ms);
  return Number.isFinite(n) ? n / 1000 : 0;
}

function toWordEntry(w: AssemblyaiWord): TranscriptionLyricWordSubdoc {
  const text = String(w.text ?? '').trim();
  const start = msToSec(w.start);
  const end = msToSec(w.end ?? w.start);
  return {
    word: text,
    start,
    end,
    syllables: [{ syllable: text || ' ', start, end }],
  };
}

/**
 * Converte a resposta de `GET /v2/transcript/:id/sentences` da AssemblyAI
 * para segmentos do Track (uma frase = um segmento).
 */
export function assemblyaiSentencesToLyricSegments(
  raw: unknown,
  languageLabel: string,
): TranscriptionLyricSegmentSubdoc[] {
  const sentences =
    raw && typeof raw === 'object'
      ? ((raw as { sentences?: unknown }).sentences as AssemblyaiSentence[])
      : undefined;
  if (!Array.isArray(sentences)) return [];

  return sentences
    .filter((s): s is AssemblyaiSentence => !!s && typeof s === 'object')
    .map((s) => ({
      start: msToSec(s.start),
      end: msToSec(s.end ?? s.start),
      text: String(s.text ?? '').trim(),
      language: languageLabel,
      words: (s.words ?? [])
        .filter((w): w is AssemblyaiWord => !!w && typeof w === 'object')
        .map(toWordEntry)
        .filter((w) => w.word.length),
    }))
    .filter((s) => s.text.length);
}

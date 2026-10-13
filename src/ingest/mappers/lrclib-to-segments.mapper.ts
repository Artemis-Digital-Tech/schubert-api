import type {
  TranscriptionLyricSegmentSubdoc,
  TranscriptionLyricSyllableSubdoc,
  TranscriptionLyricWordSubdoc,
} from '../../tracks/schemas/track.schema';

/**
 * Tempo cantado máximo estimado por sílaba (s). Acima disto, o resto do intervalo até o
 * próximo timestamp LRC é tratado como pausa/instrumental, não como parte da linha.
 */
const MAX_SEC_PER_SYLLABLE = 0.55;
/** Folga para a nota final sustentada da frase (s). */
const LINE_TAIL_SEC = 0.6;
/** Duração mínima de uma linha cantada (s). */
const MIN_LINE_SEC = 0.8;
/** Linha sem timestamp seguinte (última): duração máxima assumida (s). */
const LAST_LINE_MAX_SEC = 8;

function parseLrcTimestampSec(ts: string): number {
  const m = ts.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return NaN;
  const mm = Number(m[1]);
  const ss = Number(m[2]);
  const fracRaw = m[3] ?? '0';
  const frac = Number(`0.${fracRaw.padEnd(3, '0').slice(0, 3)}`);
  return mm * 60 + ss + frac;
}

/**
 * Número aproximado de sílabas de uma palavra (grupos de vogais), suficiente para
 * distribuir o tempo da linha de forma proporcional ao que é cantado.
 */
export function estimateSyllableCount(word: string): number {
  const w = word
    .toLowerCase()
    // Ditongos nasais contam como uma vogal (co-ra-ção, mães, põe).
    .replace(/ão|ãe|õe/g, 'a')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
  if (!w) return 1;
  const groups: string[] = w.match(/[aeiouy]+/g) ?? [];
  // Duas vogais fortes seguidas formam hiato (cla-re-ou, te-a-tro, po-e-si-a).
  let hiatus = 0;
  for (const g of groups) hiatus += g.match(/[aeo](?=[aeo])/g)?.length ?? 0;
  // Vogal fraca + forte costuma ser hiato (di-a, ri-o, po-e-si-a), exceto após q/g (qua, gue).
  const risingHiatus = w.match(/(?<![qg])[iu](?=[aeo])/g)?.length ?? 0;
  return Math.max(1, groups.length + hiatus + risingHiatus);
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

/**
 * Converte linhas LRC sincronizadas em segmentos do Track.
 *
 * - Linhas LRC vazias marcam o fim da frase anterior (pausa/instrumental).
 * - A linha só "dura" o tempo plausível de canto (por sílaba); o resto até o próximo
 *   timestamp é pausa — senão acordes do intervalo caem no meio da frase.
 * - O tempo de cada palavra é proporcional ao número de sílabas.
 */
export function lrcSyncedTextToSegments(
  syncedLyrics: string,
  durationSec?: number,
): TranscriptionLyricSegmentSubdoc[] {
  const rows = syncedLyrics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = rows
    .map((line) => {
      const m = line.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (!m) return null;
      const start = parseLrcTimestampSec(m[1]);
      if (!Number.isFinite(start)) return null;
      return { start, text: m[2].trim() };
    })
    .filter((x): x is { start: number; text: string } => !!x)
    .sort((a, b) => a.start - b.start);

  const out: TranscriptionLyricSegmentSubdoc[] = [];
  for (let idx = 0; idx < parsed.length; idx++) {
    const cur = parsed[idx];
    if (!cur.text) continue; // marcador de pausa

    const wordsText = cur.text.split(/\s+/).filter(Boolean);
    const sylls = wordsText.map(estimateSyllableCount);
    const totalSylls = sylls.reduce((a, b) => a + b, 0);

    const nextStart = parsed[idx + 1]?.start;
    const hardEnd =
      nextStart ??
      (typeof durationSec === 'number' && durationSec > cur.start
        ? Math.min(durationSec, cur.start + LAST_LINE_MAX_SEC)
        : cur.start + LAST_LINE_MAX_SEC);
    const sungEstimate = Math.max(
      MIN_LINE_SEC,
      totalSylls * MAX_SEC_PER_SYLLABLE + LINE_TAIL_SEC,
    );
    const end = Math.max(
      cur.start + 0.05,
      Math.min(hardEnd, cur.start + sungEstimate),
    );
    const dur = end - cur.start;

    let acc = 0;
    const words: TranscriptionLyricWordSubdoc[] = wordsText.map((w, wi) => {
      const ws = cur.start + (acc / totalSylls) * dur;
      acc += sylls[wi];
      const we = cur.start + (acc / totalSylls) * dur;
      const syllables: TranscriptionLyricSyllableSubdoc[] = [
        { syllable: w, start: round3(ws), end: round3(we) },
      ];
      return { word: w, start: round3(ws), end: round3(we), syllables };
    });

    out.push({
      start: round3(cur.start),
      end: round3(end),
      text: cur.text,
      language: 'unknown',
      words,
    });
  }
  return out;
}

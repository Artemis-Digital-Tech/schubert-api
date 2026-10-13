import type {
  TranscriptionLyricSegmentSubdoc,
  TranscriptionLyricWordSubdoc,
} from '../../tracks/schemas/track.schema';

/**
 * Alinhamento híbrido da letra:
 * - **texto e linhas** do LRCLIB (corretos, escritos por pessoas);
 * - **tempo de cada palavra** da transcrição automática (medido no áudio analisado).
 *
 * As duas sequências de palavras são alinhadas com Needleman–Wunsch (tolerante a erros de
 * reconhecimento, palavras a mais/a menos e refrões repetidos). Palavras do LRCLIB sem par
 * recebem tempo interpolado entre vizinhas alinhadas; linhas sem nenhum par são deslocadas
 * pelo desvio global estimado. A proporção de palavras alinhadas mede se o LRCLIB é mesmo
 * desta gravação (versão diferente → pouco alinhamento → usar a transcrição).
 */

export type HybridAlignResult = {
  segments: TranscriptionLyricSegmentSubdoc[];
  /** Fração das palavras do LRCLIB com par na transcrição (0–1). */
  matchedRatio: number;
  /** Desvio mediano (s) entre a transcrição e os tempos estimados do LRCLIB. */
  offsetSec: number;
};

const MATCH = 3;
const MISMATCH = -1;
const GAP = -1;

export function normalizeToken(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Mesma palavra, admitindo pequenos erros de reconhecimento em palavras longas. */
export function tokensMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  if (len <= 3) return false;
  return 1 - levenshtein(a, b) / len >= 0.75;
}

type Ref = { seg: number; word: number };

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round3(n: number): number {
  return Number(n.toFixed(3));
}

export function alignLyricsToAsr(
  lrc: TranscriptionLyricSegmentSubdoc[],
  asr: TranscriptionLyricSegmentSubdoc[],
): HybridAlignResult {
  const lrcRefs: Ref[] = [];
  const lrcTok: string[] = [];
  lrc.forEach((seg, si) =>
    (seg.words ?? []).forEach((w, wi) => {
      lrcRefs.push({ seg: si, word: wi });
      lrcTok.push(normalizeToken(w.word));
    }),
  );
  const asrWords: TranscriptionLyricWordSubdoc[] = asr
    .flatMap((s) => s.words ?? [])
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start! - b.start!);
  const asrTok = asrWords.map((w) => normalizeToken(w.word));

  const n = lrcTok.length;
  const m = asrTok.length;
  if (!n || !m) {
    return { segments: lrc, matchedRatio: 0, offsetSec: 0 };
  }

  // Needleman–Wunsch (pontuação + direção numa matriz plana).
  const width = m + 1;
  const score = new Int32Array((n + 1) * width);
  const dir = new Uint8Array((n + 1) * width); // 1 diag, 2 up (gap na ASR), 3 left (gap no LRC)
  for (let i = 1; i <= n; i++) {
    score[i * width] = i * GAP;
    dir[i * width] = 2;
  }
  for (let j = 1; j <= m; j++) {
    score[j] = j * GAP;
    dir[j] = 3;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag =
        score[(i - 1) * width + j - 1] +
        (tokensMatch(lrcTok[i - 1], asrTok[j - 1]) ? MATCH : MISMATCH);
      const up = score[(i - 1) * width + j] + GAP;
      const left = score[i * width + j - 1] + GAP;
      let best = diag;
      let d = 1;
      if (up > best) {
        best = up;
        d = 2;
      }
      if (left > best) {
        best = left;
        d = 3;
      }
      score[i * width + j] = best;
      dir[i * width + j] = d;
    }
  }

  /** Para cada palavra do LRCLIB, índice da palavra da ASR com que casou (ou -1). */
  const pair = new Int32Array(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const d = i > 0 && j > 0 ? dir[i * width + j] : i > 0 ? 2 : 3;
    if (d === 1) {
      if (tokensMatch(lrcTok[i - 1], asrTok[j - 1])) pair[i - 1] = j - 1;
      i--;
      j--;
    } else if (d === 2) {
      i--;
    } else {
      j--;
    }
  }

  const matched = Array.from(pair).filter((p) => p >= 0).length;
  // O LRC só é preciso no início de cada linha: o desvio mede-se pela 1.ª palavra de cada linha
  // que tenha par (os tempos das restantes palavras do LRC são estimados).
  const offsets: number[] = [];
  pair.forEach((p, k) => {
    if (p < 0) return;
    const ref = lrcRefs[k];
    if (ref.word !== 0) return;
    const lineStart = lrc[ref.seg].start;
    if (Number.isFinite(lineStart))
      offsets.push(asrWords[p].start! - Number(lineStart));
  });
  const offsetSec = median(offsets);

  // Novas palavras: tempo da ASR quando alinhadas; interpolação/deslocamento nas restantes.
  const out: TranscriptionLyricSegmentSubdoc[] = lrc.map((seg) => ({
    ...seg,
    words: (seg.words ?? []).map((w) => ({ ...w })),
  }));
  const flat = lrcRefs.map((r) => out[r.seg].words![r.word]);
  pair.forEach((p, k) => {
    if (p < 0) return;
    flat[k].start = asrWords[p].start;
    flat[k].end = asrWords[p].end;
  });

  for (let si = 0; si < out.length; si++) {
    const ws = out[si].words ?? [];
    const ks = lrcRefs
      .map((r, k) => ({ r, k }))
      .filter((x) => x.r.seg === si)
      .map((x) => x.k);
    const anchored = ks.filter((k) => pair[k] >= 0);
    if (!anchored.length) {
      // Linha sem nenhum par: mantém a forma estimada, deslocada pelo desvio global.
      for (const w of ws) {
        if (Number.isFinite(w.start)) w.start = Number(w.start) + offsetSec;
        if (Number.isFinite(w.end)) w.end = Number(w.end) + offsetSec;
      }
    } else {
      for (let idx = 0; idx < ks.length; idx++) {
        const k = ks[idx];
        if (pair[k] >= 0) continue;
        const prevK = [...ks.slice(0, idx)].reverse().find((x) => pair[x] >= 0);
        const nextK = ks.slice(idx + 1).find((x) => pair[x] >= 0);
        const est = flat[k];
        const dur = Math.max(
          0.12,
          Number(est.end ?? 0) - Number(est.start ?? 0),
        );
        if (prevK != null && nextK != null) {
          const a = flat[prevK].end!;
          const b = flat[nextK].start!;
          const gapsBetween = ks.indexOf(nextK) - ks.indexOf(prevK);
          const pos = idx - ks.indexOf(prevK);
          const t =
            a + ((b - a) * (pos - 0.5)) / Math.max(1, gapsBetween - 0.5);
          est.start = Math.max(a, t);
          est.end = Math.min(b, est.start + dur);
        } else if (prevK != null) {
          est.start = flat[prevK].end!;
          est.end = est.start + dur;
        } else if (nextK != null) {
          est.end = flat[nextK].start!;
          est.start = Math.max(0, est.end - dur);
        }
      }
    }
    // Monotonia e consistência dentro da linha.
    let lastEnd = -Infinity;
    for (const w of ws) {
      let s = Number(w.start);
      let e = Number(w.end);
      if (!Number.isFinite(s)) continue;
      if (s < lastEnd) s = lastEnd;
      if (!Number.isFinite(e) || e < s + 0.05) e = s + 0.05;
      w.start = round3(s);
      w.end = round3(e);
      w.syllables = [{ syllable: w.word || ' ', start: w.start, end: w.end }];
      lastEnd = w.end;
    }
    const timed = ws.filter((w) => Number.isFinite(w.start));
    if (timed.length) {
      out[si].start = timed[0].start;
      out[si].end = timed[timed.length - 1].end;
    }
  }

  return {
    segments: out,
    matchedRatio: matched / n,
    offsetSec: round3(offsetSec),
  };
}

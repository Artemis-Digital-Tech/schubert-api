import type { TranscriptionChordEventSubdoc } from './schemas/track.schema';

const BEATS_PER_BAR = 4;
const DEFAULT_BPM = 120;
const NC = 'N.C.';
/** Duração mínima de um acorde depois de resolver sobreposições (s). */
const MIN_CHORD_SEC = 0.05;
/** Diferença máxima (em tempos) para considerar o compasso/tempo enviado coerente com a grade. */
const GRID_MATCH_BEATS = 0.5;

type GridPoint = { t: number; b: number };

function pickNum(
  o: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickStr(
  o: Record<string, unknown>,
  keys: string[],
  fallback: string,
): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return fallback;
}

/** Tempo absoluto (0-based) a partir de compasso/tempo 1-based. */
function toAbsoluteBeat(bar: number, beat: number): number {
  return (bar - 1) * BEATS_PER_BAR + (beat - 1);
}

function fromAbsoluteBeat(abs: number): { bar: number; beat: number } {
  const b = Math.max(0, Math.round(abs));
  return {
    bar: Math.floor(b / BEATS_PER_BAR) + 1,
    beat: (b % BEATS_PER_BAR) + 1,
  };
}

function readBarBeat(
  o: Record<string, unknown>,
): { start: number; end: number } | null {
  const sb = pickNum(o, ['start_bar']);
  const sbt = pickNum(o, ['start_beat']);
  const eb = pickNum(o, ['end_bar']);
  const ebt = pickNum(o, ['end_beat']);
  if ([sb, sbt, eb, ebt].some((n) => n === undefined)) return null;
  if (sb! < 1 || eb! < 1 || sbt! < 1 || ebt! < 1) return null;
  return {
    start: toAbsoluteBeat(sb!, sbt!),
    end: toAbsoluteBeat(eb!, ebt!),
  };
}

/**
 * Pontos (segundos → tempo absoluto) a partir de acordes com compasso/tempo completos
 * (tipicamente os da Music.ai já gravados na faixa). Base para interpolar a grade.
 */
function buildGridPoints(list: unknown[]): GridPoint[] {
  const raw: GridPoint[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const s = pickNum(o, ['start']);
    const e = pickNum(o, ['end']);
    const bb = readBarBeat(o);
    if (s === undefined || e === undefined || !bb || e <= s) continue;
    if (bb.end <= bb.start) continue;
    raw.push({ t: s, b: bb.start }, { t: e, b: bb.end });
  }
  raw.sort((a, b) => a.t - b.t);
  const merged: GridPoint[] = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.t - p.t) < 1e-6) {
      last.b = (last.b + p.b) / 2;
    } else if (!last || p.b >= last.b) {
      merged.push({ ...p });
    }
  }
  return merged;
}

function beatAtTime(t: number, pts: GridPoint[]): number {
  const lerp = (p0: GridPoint, p1: GridPoint) => {
    const dt = p1.t - p0.t;
    if (Math.abs(dt) < 1e-9) return p0.b;
    return p0.b + ((t - p0.t) / dt) * (p1.b - p0.b);
  };
  if (t <= pts[0].t) return lerp(pts[0], pts[1]);
  const n = pts.length;
  if (t >= pts[n - 1].t) return lerp(pts[n - 2], pts[n - 1]);
  for (let i = 0; i < n - 1; i++) {
    if (t >= pts[i].t && t <= pts[i + 1].t) return lerp(pts[i], pts[i + 1]);
  }
  return lerp(pts[n - 2], pts[n - 1]);
}

/** Último recurso (faixa sem grade nenhuma): grade fixa a partir de t=0. */
function estimateBpm(
  durationSec: number | undefined,
  chords: { start: number; end: number }[],
): number {
  if (!durationSec || durationSec <= 0 || chords.length < 2) return DEFAULT_BPM;
  const last = Math.max(...chords.map((c) => c.end));
  if (last <= 0) return DEFAULT_BPM;
  const approxBeats = Math.max(
    chords.length,
    Math.ceil((last / durationSec) * 32),
  );
  const bpm = (approxBeats / last) * 60;
  return Math.min(200, Math.max(72, Math.round(bpm)));
}

type BeatResolver = (seconds: number) => number;

/**
 * Converte um acorde vindo do cliente (start/end obrigatórios) para o subdocumento completo.
 * Compasso/tempo enviados são mantidos quando coerentes com a grade; caso contrário
 * (acorde movido ou criado no editor) são derivados da grade.
 */
export function normalizeChordEventFromClient(
  raw: unknown,
  beatAt: BeatResolver,
): TranscriptionChordEventSubdoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const start = pickNum(o, ['start']);
  const end = pickNum(o, ['end']);
  if (start === undefined || end === undefined) return null;
  const startT = Math.max(0, start);
  const endT = Math.max(startT, end);

  const derivedStart = beatAt(startT);
  const derivedEnd = beatAt(endT);
  const given = readBarBeat(o);
  const keepGiven =
    given != null &&
    Math.abs(given.start - derivedStart) <= GRID_MATCH_BEATS &&
    Math.abs(given.end - derivedEnd) <= GRID_MATCH_BEATS;
  const startBB = fromAbsoluteBeat(keepGiven ? given.start : derivedStart);
  const endBB = fromAbsoluteBeat(keepGiven ? given.end : derivedEnd);

  const maj = pickStr(o, ['chord_majmin', 'chordMajmin'], NC);
  const bass = typeof o.bass === 'string' ? o.bass.trim() : null;
  const bassN =
    typeof o.bass_nashville === 'string' ? o.bass_nashville.trim() : null;
  return {
    start: startT,
    end: endT,
    start_bar: startBB.bar,
    start_beat: startBB.beat,
    end_bar: endBB.bar,
    end_beat: endBB.beat,
    chord_majmin: maj,
    bass: bass || null,
    bass_nashville: bassN || null,
    chord_complex_jazz: pickStr(o, ['chord_complex_jazz'], maj),
    chord_simple_jazz: pickStr(o, ['chord_simple_jazz'], maj),
    chord_basic_jazz: pickStr(o, ['chord_basic_jazz'], maj),
    chord_complex_pop: pickStr(o, ['chord_complex_pop'], maj),
    chord_simple_pop: pickStr(o, ['chord_simple_pop'], maj),
    chord_basic_pop: pickStr(o, ['chord_basic_pop'], maj),
    chord_complex_nashville: pickStr(o, ['chord_complex_nashville'], maj),
    chord_simple_nashville: pickStr(o, ['chord_simple_nashville'], maj),
    chord_basic_nashville: pickStr(o, ['chord_basic_nashville'], maj),
  };
}

/**
 * Normaliza a lista de acordes enviada pelo editor.
 *
 * - Grade de compassos: preferencialmente a dos acordes já gravados (`referenceChords`, vindos
 *   da Music.ai), senão a dos próprios acordes enviados; só sem nenhuma grade usa um BPM estimado.
 * - Lista ordenada por `start` e sem sobreposições: um acorde vale até o início do seguinte.
 */
export function normalizeChordListFromClient(
  rawList: unknown,
  durationSec: number | undefined,
  referenceChords?: unknown[],
): TranscriptionChordEventSubdoc[] {
  if (!Array.isArray(rawList)) return [];

  let pts = buildGridPoints(
    Array.isArray(referenceChords) ? referenceChords : [],
  );
  if (pts.length < 2) pts = buildGridPoints(rawList);

  let beatAt: BeatResolver;
  if (pts.length >= 2) {
    beatAt = (s) => beatAtTime(s, pts);
  } else {
    const rough = rawList
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const o = r as Record<string, unknown>;
        const s = pickNum(o, ['start']);
        const e = pickNum(o, ['end']);
        if (s === undefined || e === undefined) return null;
        return { start: Math.max(0, s), end: Math.max(s, e) };
      })
      .filter((x): x is { start: number; end: number } => x != null);
    const bpm = estimateBpm(durationSec, rough);
    beatAt = (s) => (Math.max(0, s) * bpm) / 60;
  }

  const out: TranscriptionChordEventSubdoc[] = [];
  for (const item of rawList) {
    const n = normalizeChordEventFromClient(item, beatAt);
    if (n) out.push(n);
  }
  out.sort((a, b) => a.start - b.start);

  // Sem sobreposições: o acorde anterior termina onde o seguinte começa.
  const resolved: TranscriptionChordEventSubdoc[] = [];
  for (const c of out) {
    const prev = resolved[resolved.length - 1];
    if (prev && prev.end > c.start) {
      if (c.start - prev.start < MIN_CHORD_SEC) {
        // Mesmo instante: o mais recente na lista substitui o anterior.
        resolved[resolved.length - 1] = c;
        continue;
      }
      if (c.end < prev.end) {
        // Acorde inserido dentro de outro: vale até onde o anterior ia (até o próximo acorde).
        c.end = prev.end;
        const endBB = fromAbsoluteBeat(beatAt(c.end));
        c.end_bar = endBB.bar;
        c.end_beat = endBB.beat;
      }
      prev.end = c.start;
      const endBB = fromAbsoluteBeat(beatAt(prev.end));
      const startAbs = toAbsoluteBeat(prev.start_bar, prev.start_beat);
      const endAbs = Math.max(
        startAbs + 1,
        toAbsoluteBeat(endBB.bar, endBB.beat),
      );
      const fixed = fromAbsoluteBeat(endAbs);
      prev.end_bar = fixed.bar;
      prev.end_beat = fixed.beat;
    }
    if (c.end - c.start < MIN_CHORD_SEC) continue;
    resolved.push(c);
  }
  return resolved;
}

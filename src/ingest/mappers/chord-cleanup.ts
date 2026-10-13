import type { TranscriptionChordEventSubdoc } from '../../tracks/schemas/track.schema';

const BEATS_PER_BAR = 4;

function isNoChord(c: TranscriptionChordEventSubdoc): boolean {
  const v = String(c.chord_majmin ?? '')
    .trim()
    .toUpperCase();
  return v === 'N' || v === 'NC' || v === 'N.C.' || v.startsWith('N:');
}

function chordKey(c: TranscriptionChordEventSubdoc): string {
  return `${String(c.chord_simple_pop || c.chord_majmin || '').trim()}/${c.bass ?? ''}`;
}

/** Duração mediana de um tempo (s) a partir de compasso/tempo dos acordes. */
export function estimateBeatSecFromChords(
  chords: TranscriptionChordEventSubdoc[],
): number | undefined {
  const samples: number[] = [];
  for (const c of chords) {
    const beats =
      (c.end_bar - 1) * BEATS_PER_BAR +
      (c.end_beat - 1) -
      ((c.start_bar - 1) * BEATS_PER_BAR + (c.start_beat - 1));
    const secs = c.end - c.start;
    if (Number.isFinite(beats) && beats > 0 && secs > 0)
      samples.push(secs / beats);
  }
  if (!samples.length) return undefined;
  samples.sort((a, b) => a - b);
  const m = Math.floor(samples.length / 2);
  const med =
    samples.length % 2 ? samples[m] : (samples[m - 1] + samples[m]) / 2;
  return med >= 0.2 && med <= 2 ? med : undefined;
}

function extendTo(
  target: TranscriptionChordEventSubdoc,
  from: TranscriptionChordEventSubdoc,
): void {
  target.end = from.end;
  target.end_bar = from.end_bar;
  target.end_beat = from.end_beat;
}

/**
 * Limpa a sequência de acordes da Music.ai para a leitura da cifra:
 * - eventos seguidos do mesmo acorde viram um só;
 * - «sem acorde» (N) com menos de 1 tempo entre acordes é absorvido pelo anterior;
 * - fragmentos com menos de meio tempo (ruído de deteção) são absorvidos pelo anterior.
 */
export function cleanupChordEvents(
  input: TranscriptionChordEventSubdoc[],
): TranscriptionChordEventSubdoc[] {
  const chords = [...input]
    .map((c) => ({ ...c }))
    .sort((a, b) => a.start - b.start);
  if (chords.length < 2) return chords;
  const beat = estimateBeatSecFromChords(chords) ?? 0.5;

  const out: TranscriptionChordEventSubdoc[] = [];
  for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    const prev = out[out.length - 1];
    const next = chords[i + 1];
    const dur = c.end - c.start;
    if (prev && next) {
      const shortNoChord = isNoChord(c) && dur < beat * 0.99;
      const fragment = !isNoChord(c) && dur < beat * 0.5;
      if (shortNoChord || fragment) {
        extendTo(prev, c);
        continue;
      }
    }
    if (prev && chordKey(prev) === chordKey(c) && !isNoChord(c)) {
      extendTo(prev, c);
      continue;
    }
    out.push(c);
  }
  return out;
}

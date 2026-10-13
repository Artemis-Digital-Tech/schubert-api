import type { TranscriptionChordEventSubdoc } from '../../tracks/schemas/track.schema';
import { cleanupChordEvents, estimateBeatSecFromChords } from './chord-cleanup';

/** 120 BPM: tempo = 0,5 s; compasso = 2 s. Posições em tempos absolutos (0-based). */
function ev(
  label: string,
  startBeat: number,
  endBeat: number,
): TranscriptionChordEventSubdoc {
  const bb = (b: number) => ({ bar: Math.floor(b / 4) + 1, beat: (b % 4) + 1 });
  const s = bb(startBeat);
  const e = bb(endBeat);
  return {
    start: startBeat * 0.5,
    end: endBeat * 0.5,
    start_bar: s.bar,
    start_beat: s.beat,
    end_bar: e.bar,
    end_beat: e.beat,
    chord_majmin: label,
    bass: null,
    bass_nashville: null,
    chord_complex_jazz: label,
    chord_simple_jazz: label,
    chord_basic_jazz: label,
    chord_complex_pop: label,
    chord_simple_pop: label,
    chord_basic_pop: label,
    chord_complex_nashville: label,
    chord_simple_nashville: label,
    chord_basic_nashville: label,
  };
}

describe('cleanupChordEvents', () => {
  it('estima o tempo a partir da grade', () => {
    expect(estimateBeatSecFromChords([ev('C', 0, 4), ev('G', 4, 8)])).toBe(0.5);
  });

  it('funde eventos seguidos do mesmo acorde', () => {
    const out = cleanupChordEvents([
      ev('C', 0, 4),
      ev('C', 4, 8),
      ev('G', 8, 12),
    ]);
    expect(out.map((c) => [c.chord_majmin, c.start, c.end, c.end_bar])).toEqual(
      [
        ['C', 0, 4, 3],
        ['G', 4, 6, 4],
      ],
    );
  });

  it('absorve «sem acorde» curto entre acordes', () => {
    const out = cleanupChordEvents([
      ev('C', 0, 4),
      { ...ev('N', 4, 4), end: 2.2 },
      { ...ev('G', 4, 8), start: 2.2 },
    ]);
    expect(out.map((c) => c.chord_majmin)).toEqual(['C', 'G']);
  });

  it('mantém «sem acorde» longo (pausa real)', () => {
    const out = cleanupChordEvents([
      ev('C', 0, 4),
      ev('N', 4, 8),
      ev('G', 8, 12),
    ]);
    expect(out.map((c) => c.chord_majmin)).toEqual(['C', 'N', 'G']);
  });

  it('absorve fragmento de menos de meio tempo', () => {
    const out = cleanupChordEvents([
      ev('C', 0, 4),
      { ...ev('F', 4, 4), end: 2.1 },
      { ...ev('G', 4, 8), start: 2.1 },
    ]);
    expect(out.map((c) => c.chord_majmin)).toEqual(['C', 'G']);
  });
});

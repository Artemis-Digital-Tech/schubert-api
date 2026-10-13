import { normalizeChordListFromClient } from './transcription-chord-normalize.util';

/** Música a 90 BPM (tempo = 0,667 s, compasso 4/4), 1.º downbeat em 0,5 s, um acorde por compasso. */
function musicAiChords(count: number) {
  const beat = 60 / 90;
  const bar = 4 * beat;
  const prog = ['G', 'D', 'Em', 'C'];
  return Array.from({ length: count }, (_, i) => ({
    start: 0.5 + i * bar,
    end: 0.5 + (i + 1) * bar,
    start_bar: i + 1,
    start_beat: 1,
    end_bar: i + 2,
    end_beat: 1,
    chord_majmin: prog[i % 4],
  }));
}

describe('normalizeChordListFromClient', () => {
  it('preserva a grade da Music.ai num salvamento sem alterações', () => {
    const chords = musicAiChords(74);
    const out = normalizeChordListFromClient(chords, 200, chords);
    expect(out).toHaveLength(74);
    out.forEach((c, i) => {
      expect(c.start_bar).toBe(i + 1);
      expect(c.start_beat).toBe(1);
    });
  });

  it('preserva a grade mesmo sem acordes de referência (usa os enviados)', () => {
    const chords = musicAiChords(20);
    const out = normalizeChordListFromClient(chords, 200);
    expect(out.every((c) => c.start_beat === 1)).toBe(true);
    expect(out[10].start_bar).toBe(11);
  });

  it('acorde movido recebe compasso/tempo coerentes com a grade real', () => {
    const reference = musicAiChords(8);
    const edited = reference.map((c) => ({ ...c }));
    // Move o 4.º acorde (compasso 4) para começar 2 tempos depois (tempo 3), com metadados antigos.
    const beat = 60 / 90;
    edited[3] = { ...edited[3], start: edited[3].start + 2 * beat };
    const out = normalizeChordListFromClient(edited, 30, reference);
    const moved = out.find((c) => c.chord_majmin === 'C' && c.start_bar === 4);
    expect(moved).toBeDefined();
    expect(moved!.start_beat).toBe(3);
  });

  it('ordena a lista e resolve sobreposições: acorde inserido vale até onde o anterior ia', () => {
    const out = normalizeChordListFromClient(
      [
        { start: 0, end: 4, chord_majmin: 'C' },
        { start: 4, end: 8, chord_majmin: 'G' },
        { start: 2, end: 2.42, chord_majmin: 'D' }, // anexado no fim pelo editor
      ],
      8,
    );
    expect(out.map((c) => [c.chord_majmin, c.start, c.end])).toEqual([
      ['C', 0, 2],
      ['D', 2, 4],
      ['G', 4, 8],
    ]);
  });

  it('dois acordes no mesmo instante: o mais recente substitui o anterior', () => {
    const out = normalizeChordListFromClient(
      [
        { start: 0, end: 2, chord_majmin: 'C' },
        { start: 0, end: 2, chord_majmin: 'Am' },
      ],
      2,
    );
    expect(out.map((c) => c.chord_majmin)).toEqual(['Am']);
  });
});

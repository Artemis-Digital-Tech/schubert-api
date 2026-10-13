import {
  estimateSyllableCount,
  lrcSyncedTextToSegments,
} from './lrclib-to-segments.mapper';

describe('lrcSyncedTextToSegments', () => {
  it('não estica a linha pelo intervalo instrumental até a próxima linha', () => {
    // Frase curta às 8 s; próxima linha só às 20 s (12 s de instrumental no meio).
    const segs = lrcSyncedTextToSegments(
      '[00:08.00] eu vi o sol nascer\n[00:20.00] e o dia clareou',
    );
    expect(segs).toHaveLength(2);
    // 6 sílabas → no máximo ~3,9 s cantados, bem antes dos 20 s.
    expect(segs[0].end).toBeLessThan(12.5);
    expect(segs[0].words!.at(-1)!.end).toBe(segs[0].end);
  });

  it('usa linhas LRC vazias como fim da frase', () => {
    const segs = lrcSyncedTextToSegments(
      '[00:08.00] eu vi o sol nascer e o dia clareou devagar\n[00:10.50]\n[00:16.00] outra linha',
    );
    expect(segs).toHaveLength(2);
    expect(segs[0].end).toBeLessThanOrEqual(10.5);
    expect(segs.map((s) => s.text)).toEqual([
      'eu vi o sol nascer e o dia clareou devagar',
      'outra linha',
    ]);
  });

  it('distribui o tempo por sílabas (palavra longa recebe mais tempo)', () => {
    const [seg] = lrcSyncedTextToSegments(
      '[00:00.00] eu clareou\n[00:02.00] fim',
    );
    const [eu, clareou] = seg.words!;
    expect(clareou.end! - clareou.start!).toBeGreaterThan(eu.end! - eu.start!);
  });

  it('respeita o limite do próximo timestamp quando a frase é longa', () => {
    const segs = lrcSyncedTextToSegments(
      '[00:00.00] uma frase bem comprida com muitas silabas cantadas rapidamente\n[00:03.00] seguinte',
    );
    expect(segs[0].end).toBeLessThanOrEqual(3);
  });
});

describe('estimateSyllableCount', () => {
  it.each([
    ['sol', 1],
    ['nascer', 2],
    ['coração', 3],
    ['clareou', 3],
    ['saudade', 3],
    ['poesia', 4],
    ['teatro', 3],
    ['mães', 1],
    ['quando', 2],
    ['história', 4],
  ])('%s → %i', (word, n) => {
    expect(estimateSyllableCount(word)).toBe(n);
  });
});

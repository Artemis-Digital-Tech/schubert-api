import type { TranscriptionLyricSegmentSubdoc } from '../../tracks/schemas/track.schema';
import { alignLyricsToAsr, tokensMatch } from './lyrics-hybrid-align';
import { lrcSyncedTextToSegments } from './lrclib-to-segments.mapper';

const asrLine = (
  words: [string, number, number][],
): TranscriptionLyricSegmentSubdoc => ({
  start: words[0][1],
  end: words[words.length - 1][2],
  text: words.map((w) => w[0]).join(' '),
  words: words.map(([word, start, end]) => ({ word, start, end })),
});

describe('alignLyricsToAsr', () => {
  // LRCLIB: texto certo, tempos estimados (versão de estúdio, 2 s mais cedo que o áudio analisado).
  const lrc = lrcSyncedTextToSegments(
    '[00:06.00] eu vi o sol nascer\n[00:10.00] e o dia clareou',
  );
  // Transcrição do áudio real: tempos medidos, com um erro de reconhecimento ("nasce").
  const asr = [
    asrLine([
      ['eu', 8.0, 8.3],
      ['vi', 8.3, 8.6],
      ['o', 8.6, 8.8],
      ['sol', 8.8, 9.3],
      ['nasce', 9.3, 10.0],
    ]),
    asrLine([
      ['e', 12.0, 12.2],
      ['o', 12.2, 12.4],
      ['dia', 12.4, 12.9],
      ['clareou', 12.9, 13.8],
    ]),
  ];

  it('mantém o texto do LRCLIB e usa os tempos medidos da transcrição', () => {
    const r = alignLyricsToAsr(lrc, asr);
    expect(r.segments.map((s) => s.text)).toEqual([
      'eu vi o sol nascer',
      'e o dia clareou',
    ]);
    const words = r.segments[0].words!;
    expect(words[0]).toMatchObject({ word: 'eu', start: 8, end: 8.3 });
    expect(words[3]).toMatchObject({ word: 'sol', start: 8.8 });
    expect(r.segments[1].words![3]).toMatchObject({
      word: 'clareou',
      start: 12.9,
      end: 13.8,
    });
  });

  it('palavra com erro de reconhecimento recebe tempo coerente entre as vizinhas', () => {
    const r = alignLyricsToAsr(lrc, asr);
    const nascer = r.segments[0].words![4];
    expect(nascer.word).toBe('nascer');
    expect(nascer.start!).toBeGreaterThanOrEqual(9.3);
    expect(nascer.end!).toBeLessThanOrEqual(12);
  });

  it('mede o alinhamento e o desvio global (LRCLIB 2 s adiantado)', () => {
    const r = alignLyricsToAsr(lrc, asr);
    expect(r.matchedRatio).toBeGreaterThan(0.8);
    expect(r.offsetSec).toBeGreaterThan(1.5);
    expect(r.offsetSec).toBeLessThan(2.6);
  });

  it('letra de outra música quase não alinha', () => {
    const other = lrcSyncedTextToSegments(
      '[00:05.00] noite fria sem luar\n[00:09.00] vento leva meu cantar',
    );
    expect(alignLyricsToAsr(other, asr).matchedRatio).toBeLessThan(0.2);
  });
});

describe('tokensMatch', () => {
  it.each([
    ['nascer', 'nasce', true],
    ['coracao', 'coracao', true],
    ['o', 'a', false],
    ['sol', 'sou', false],
  ])('%s × %s', (a, b, expected) => {
    expect(tokensMatch(a, b)).toBe(expected);
  });
});

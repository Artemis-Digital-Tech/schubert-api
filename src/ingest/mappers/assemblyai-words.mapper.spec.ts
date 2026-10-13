import { assemblyaiWordsToLyricSegments } from './assemblyai-words.mapper';

const w = (text: string, startSec: number, endSec: number) => ({
  text,
  start: startSec * 1000,
  end: endSec * 1000,
});

describe('assemblyaiWordsToLyricSegments', () => {
  it('quebra a linha nas pausas da voz, não na pontuação', () => {
    const segs = assemblyaiWordsToLyricSegments(
      [
        w('eu', 8.0, 8.3),
        w('vi', 8.3, 8.6),
        w('o', 8.6, 8.8),
        w('sol', 8.8, 9.2),
        w('nascer', 9.2, 10.0),
        // 2 s de instrumental
        w('e', 12.0, 12.2),
        w('o', 12.2, 12.4),
        w('dia', 12.4, 13.0),
      ],
      'portuguese',
    );
    expect(segs.map((s) => s.text)).toEqual(['eu vi o sol nascer', 'e o dia']);
    expect(segs[0].start).toBe(8);
    expect(segs[0].end).toBe(10);
    expect(segs[0].language).toBe('portuguese');
  });

  it('corta pela pontuação só quando há uma pausa curta', () => {
    const segs = assemblyaiWordsToLyricSegments(
      [
        w('vem,', 1.0, 1.4),
        w('amor', 1.7, 2.2),
        w('fica,', 2.2, 2.6),
        w('aqui', 2.62, 3.0),
      ],
      'portuguese',
    );
    expect(segs.map((s) => s.text)).toEqual(['vem,', 'amor fica, aqui']);
  });

  it('limita o tamanho da linha', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      w('palavra', i * 0.4, i * 0.4 + 0.35),
    );
    const segs = assemblyaiWordsToLyricSegments(many, 'portuguese');
    expect(segs.length).toBeGreaterThan(1);
    expect(segs.every((s) => s.text!.length <= 42)).toBe(true);
  });

  it('converte milissegundos para segundos e ignora palavras vazias', () => {
    const segs = assemblyaiWordsToLyricSegments(
      [w('', 0, 0.1), w('oi', 1.5, 2.0)],
      'portuguese',
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].words![0]).toMatchObject({ word: 'oi', start: 1.5, end: 2 });
  });
});

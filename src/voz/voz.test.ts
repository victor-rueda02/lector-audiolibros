import { describe, expect, it } from 'vitest';
import { listarVocesCatalogo, resolverVoz } from './catalogo.ts';
import { crearLimitador, estimarEta } from './eta.ts';
import { dividirEnFrases, planificarTexto, silencioFinalSeg } from './frases.ts';
import { CodificadorMp3, KBPS_MP3 } from './mp3.ts';

describe('dividirEnFrases', () => {
  it('separa por puntuación final', () => {
    expect(dividirEnFrases('Hola. ¿Qué tal? ¡Muy bien! Y tú…')).toEqual(['Hola.', '¿Qué tal?', '¡Muy bien!', 'Y tú…']);
  });
  it('respeta el máximo cortando por comas y espacios', () => {
    const larga = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(', ');
    const fs = dividirEnFrases(larga, 100);
    expect(fs.length).toBeGreaterThan(3);
    for (const f of fs) expect(f.length).toBeLessThanOrEqual(100);
    const sinComas = Array.from({ length: 200 }, () => 'abc').join(' ');
    for (const f of dividirEnFrases(sinComas, 50)) expect(f.length).toBeLessThanOrEqual(50);
  });
  it('descarta fragmentos sin letras y texto vacío', () => {
    expect(dividirEnFrases('   ')).toEqual([]);
    expect(dividirEnFrases('Hola. ... ¡! Adiós.')).toEqual(['Hola.', 'Adiós.']);
  });
});

describe('planificarTexto', () => {
  it('asigna pausas: título, entre frases y entre párrafos', () => {
    const plan = planificarTexto('Capítulo 1', ['Una. Dos.', 'Tres.']);
    expect(plan.map((s) => s.pausaDespuesSeg)).toEqual([1.2, 0.25, 0.7, 0.7]);
    expect(plan.map((s) => s.texto)).toEqual(['Capítulo 1', 'Una.', 'Dos.', 'Tres.']);
  });
});

describe('silencioFinalSeg', () => {
  it('mide el silencio final', () => {
    const m = new Float32Array(1000);
    m.fill(0.5, 0, 600);
    expect(silencioFinalSeg(m, 1000)).toBeCloseTo(0.4, 3);
  });
});

describe('estimarEta', () => {
  it('es null hasta tener 3 frases', () => {
    expect(estimarEta(100, 1000, 5, 2)).toBeNull();
  });
  it('extrapola según el ritmo', () => {
    expect(estimarEta(100, 1000, 10, 3)).toBeCloseTo(90, 5);
  });
});

describe('crearLimitador', () => {
  it('permite como mucho 4 por segundo', () => {
    let t = 0;
    const ok = crearLimitador(4, () => t);
    let pasan = 0;
    for (t = 0; t < 1000; t += 10) if (ok()) pasan++;
    expect(pasan).toBe(4);
    expect(ok(true)).toBe(true);
  });
});

describe('catálogo', () => {
  it('tiene 9 voces (España, México, Argentina) y resuelve hablantes', () => {
    const voces = listarVocesCatalogo();
    expect(voces).toHaveLength(9);
    expect(new Set(voces.map((v) => v.id)).size).toBe(9);
    expect(resolverVoz('es_MX-claude-high')?.urlOnnx).toBe(
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx',
    );
    expect(voces.find((v) => v.id === 'es_AR-daniela-high')?.urlMuestra).toBe(
      'https://rhasspy.github.io/piper-samples/samples/es/es_AR/daniela/high/speaker_0.mp3',
    );
    expect(resolverVoz('es_ES-sharvard-medium#F')?.hablante).toBe('F');
    expect(resolverVoz('es_ES-davefx-medium')?.urlOnnx).toBe(
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
    );
    expect(resolverVoz('es_ES-sharvard-medium')).toBeNull();
    expect(resolverVoz('nada')).toBeNull();
  });
});

describe('CodificadorMp3', () => {
  it('codifica un seno a MP3 con cabecera de trama válida y tamaño acorde a 48 kbps', () => {
    for (const frecuencia of [22050, 16000]) {
      const seg = 5;
      const cod = new CodificadorMp3(frecuencia);
      const seno = new Float32Array(frecuencia * seg);
      for (let i = 0; i < seno.length; i++) seno[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / frecuencia);
      // En dos fragmentos, como hace el generador.
      cod.anadir(seno.subarray(0, 12345));
      cod.anadir(seno.subarray(12345));
      const mp3 = cod.finalizar();
      expect(mp3[0]).toBe(0xff);
      expect(mp3[1] & 0xe0).toBe(0xe0);
      const esperado = (KBPS_MP3 * 1000 * seg) / 8;
      expect(mp3.length).toBeGreaterThan(esperado * 0.9);
      expect(mp3.length).toBeLessThan(esperado * 1.15);
      expect(cod.duracionSeg).toBeCloseTo(seg, 3);
    }
  });
});

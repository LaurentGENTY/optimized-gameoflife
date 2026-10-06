import { afterEach, describe, expect, it } from 'vitest';
import { engineUnavailable, getEngine, tracedVariant, visibleEngines } from '../src/engines/registry';

const original = (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated;
afterEach(() => {
  (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = original;
});

describe('engine availability', () => {
  it('greys out wasm-mt without cross-origin isolation, with a reason', () => {
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = false;
    expect(engineUnavailable(getEngine('wasm-mt'))).toMatch(/cross-origin isolation/);
  });

  it('offers wasm-mt when the page is cross-origin isolated', () => {
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated = true;
    expect(engineUnavailable(getEngine('wasm-mt'))).toBeNull();
  });

  it('never greys out engines without an availability rule', () => {
    expect(engineUnavailable(getEngine('wasm-seq'))).toBeNull();
  });
});

describe('traced variants', () => {
  it('hides traced variants from engine lists', () => {
    expect(visibleEngines().map((e) => e.id)).not.toContain('wasm-mt-trace');
  });

  it('maps engines to their monitoring variant', () => {
    expect(tracedVariant('wasm-mt')).toBe('wasm-mt-trace');
    expect(tracedVariant('wasm-seq')).toBeNull();
  });
});

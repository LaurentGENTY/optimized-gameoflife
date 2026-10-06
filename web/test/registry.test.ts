import { afterEach, describe, expect, it } from 'vitest';
import { engineUnavailable, getEngine } from '../src/engines/registry';

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

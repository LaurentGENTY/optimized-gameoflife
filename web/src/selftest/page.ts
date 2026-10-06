import { ENGINES, getEngine, type EngineEnv } from '../engines/registry';
import { buildGrid } from '../patterns/presets';
import { runSelfTest, SELFTEST_CASES, type SelfTestResult } from './selftest';

declare global {
  interface Window {
    __selftest?: SelfTestResult[];
  }
}

const REFERENCE = 'wasm-seq';

export async function runSelfTestPage(root: HTMLElement, env: EngineEnv): Promise<void> {
  root.innerHTML = '<h1>Self-test</h1><p id="st-status">running…</p><table id="st"></table>';
  const results = await runSelfTest(
    {
      referenceId: REFERENCE,
      engineIds: ENGINES.map((e) => e.id).filter((id) => id !== REFERENCE),
      createEngine: (id) => getEngine(id).create(env),
      buildGrid,
    },
    SELFTEST_CASES,
  );
  const pass = results.length > 0 && results.every((r) => r.ok);
  const table = root.querySelector<HTMLTableElement>('#st')!;
  const head = table.insertRow();
  for (const h of ['engine', 'case', 'expected', 'actual', 'result']) head.insertCell().textContent = h;
  for (const r of results) {
    const row = table.insertRow();
    row.className = r.ok ? 'ok' : 'ko';
    row.insertCell().textContent = r.engineId;
    row.insertCell().textContent = `${r.testCase.presetId} ${r.testCase.size}² × ${r.testCase.gens}`;
    row.insertCell().textContent = r.expected;
    row.insertCell().textContent = r.actual ?? '—';
    row.insertCell().textContent = r.ok ? 'pass' : `FAIL${r.error ? `: ${r.error}` : ''}`;
  }
  root.querySelector('#st-status')!.textContent = results.length === 0 ? 'no engine to compare' : pass ? 'pass' : 'fail';
  document.title = `selftest: ${pass ? 'pass' : 'fail'}`;
  window.__selftest = results;
}

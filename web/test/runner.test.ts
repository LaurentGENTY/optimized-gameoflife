import { describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/grid';
import { LiveRunner } from '../src/live/runner';
import { FakeEngine, sleep } from './fakes';

async function setup(statsIntervalMs = 500) {
  const engine = new FakeEngine();
  await engine.init(createGrid(8));
  const cb = { onFrame: vi.fn(), onStats: vi.fn(), onError: vi.fn() };
  return { engine, cb, runner: new LiveRunner(engine, cb, { statsIntervalMs }) };
}

describe('LiveRunner', () => {
  it('counts exactly the generations the engine computed', async () => {
    const { engine, runner } = await setup();
    runner.play();
    await sleep(20);
    await runner.pause();
    expect(runner.generation).toBeGreaterThan(0);
    expect(runner.generation).toBe(engine.generation);
  });

  it('stops stepping once paused', async () => {
    const { engine, runner } = await setup();
    runner.play();
    await sleep(10);
    await runner.pause();
    const g = engine.generation;
    await sleep(10);
    expect(engine.generation).toBe(g);
    expect(runner.playing).toBe(false);
  });

  it('fetches one frame per requestFrame, not one per batch', async () => {
    const { cb, runner } = await setup();
    runner.play();
    await sleep(10);
    expect(cb.onFrame).toHaveBeenCalledTimes(1);
    runner.requestFrame();
    await sleep(10);
    expect(cb.onFrame).toHaveBeenCalledTimes(2);
    await runner.pause();
  });

  it('step() pauses, advances exactly one generation and emits a frame', async () => {
    const { engine, cb, runner } = await setup();
    runner.play();
    await sleep(5);
    await runner.pause();
    const g = runner.generation;
    cb.onFrame.mockClear();
    runner.play();
    await runner.step();
    expect(runner.playing).toBe(false);
    expect(engine.generation).toBe(runner.generation);
    expect(cb.onFrame).toHaveBeenCalled();
    expect(runner.generation).toBeGreaterThan(g);
    const g2 = runner.generation;
    await runner.step();
    expect(runner.generation).toBe(g2 + 1);
  });

  it('step() reports the new generation through onStats', async () => {
    const { cb, runner } = await setup();
    await runner.step();
    expect(cb.onStats).toHaveBeenLastCalledWith({ generation: 1, gensPerSec: 0 });
  });

  it('reports engine errors and stops playing', async () => {
    const { engine, cb, runner } = await setup();
    engine.failAt = 100;
    runner.play();
    await sleep(20);
    expect(cb.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
    expect(runner.playing).toBe(false);
  });

  it('emits gens/s stats while playing', async () => {
    const { cb, runner } = await setup(1);
    runner.play();
    await sleep(20);
    await runner.pause();
    const stats = cb.onStats.mock.calls.at(-1)?.[0];
    expect(stats.generation).toBeGreaterThan(0);
    expect(stats.gensPerSec).toBeGreaterThan(0);
  });
  it('forwards a trace batch after each fetched frame', async () => {
    const { engine, cb, runner } = await setup();
    const onTrace = vi.fn();
    const batch = { kind: 'gpu' as const, samples: new Float64Array(0), lost: 0 };
    engine.traceBatches = [batch];
    const traced = new LiveRunner(engine, { ...cb, onTrace });
    traced.requestFrame();
    await traced.step();
    expect(onTrace).toHaveBeenCalledWith(batch);
    void runner;
  });
});

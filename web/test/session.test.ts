import { describe, expect, it, vi } from 'vitest';
import type { FrameSource } from '../src/engine';
import { createGrid } from '../src/grid';
import { Session } from '../src/live/session';
import { FakeEngine } from './fakes';

function setup(makeEngine: (id: string) => FakeEngine) {
  const created: FakeEngine[] = [];
  const frames: FrameSource[] = [];
  const onError = vi.fn();
  const onStats = vi.fn();
  const session = new Session({
    createEngine: (id) => {
      const e = makeEngine(id);
      created.push(e);
      return e;
    },
    buildGrid: (_preset, size) => createGrid(size),
    onFrame: (f) => frames.push(f),
    onStats,
    onError,
  });
  return { session, created, frames, onError, onStats };
}

describe('Session', () => {
  it('builds the grid, inits the engine and emits its first frame', async () => {
    const { session, frames } = setup(() => new FakeEngine());
    expect(await session.load({ engineId: 'fake', presetId: 'random', size: 16 })).toBe(true);
    expect(frames).toHaveLength(1);
    expect(frames[0].size).toBe(16);
  });

  it('lets the newest load win over a slower earlier one', async () => {
    const { session, created, frames } = setup((id) => {
      const e = new FakeEngine();
      if (id === 'slow') e.initDelayMs = 30;
      return e;
    });
    const first = session.load({ engineId: 'slow', presetId: 'random', size: 16 });
    const second = session.load({ engineId: 'fast', presetId: 'random', size: 32 });
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(created[0].disposed).toBe(true);
    expect(created[1].disposed).toBe(false);
    expect(frames.map((f) => f.size)).toEqual([32]);
  });

  it('disposes the previous engine on reload and stops its loop', async () => {
    const { session, created } = setup(() => new FakeEngine());
    await session.load({ engineId: 'fake', presetId: 'random', size: 16 });
    session.play();
    await session.load({ engineId: 'fake', presetId: 'random', size: 16 });
    expect(created[0].disposed).toBe(true);
    const g = created[0].generation;
    await new Promise((r) => setTimeout(r, 10));
    expect(created[0].generation).toBe(g);
    expect(session.playing).toBe(false);
  });

  it('reports init failures and keeps no engine', async () => {
    const { session, created, onError } = setup(() => {
      const e = new FakeEngine();
      e.initError = new Error('out of memory');
      return e;
    });
    expect(await session.load({ engineId: 'fake', presetId: 'random', size: 16 })).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'out of memory' }));
    expect(created[0].disposed).toBe(true);
    session.play();
    expect(session.playing).toBe(false);
  });

  it('silences a superseded engine: no stale error, stats or frame after reload', async () => {
    const { session, created, frames, onError, onStats } = setup((id) => {
      const e = new FakeEngine();
      if (id === 'slow') e.stepDelayMs = 30;
      return e;
    });
    await session.load({ engineId: 'slow', presetId: 'random', size: 16 });
    const step = session.step();
    await session.load({ engineId: 'fast', presetId: 'random', size: 32 });
    await step;
    await new Promise((r) => setTimeout(r, 50));
    expect(created[0].disposed).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onStats).not.toHaveBeenCalled();
    expect(frames.map((f) => f.size)).toEqual([16, 32]);
  });

  it('honours Play pressed while the engine is still loading', async () => {
    const { session, created } = setup(() => {
      const e = new FakeEngine();
      e.initDelayMs = 30;
      return e;
    });
    const loading = session.load({ engineId: 'fake', presetId: 'random', size: 16 });
    session.play();
    expect(session.playing).toBe(true);
    await loading;
    await new Promise((r) => setTimeout(r, 20));
    expect(session.playing).toBe(true);
    expect(created[0].generation).toBeGreaterThan(0);
    await session.pause();
  });

  it('drops a Play intent when Pause follows it during loading', async () => {
    const { session, created } = setup(() => {
      const e = new FakeEngine();
      e.initDelayMs = 30;
      return e;
    });
    const loading = session.load({ engineId: 'fake', presetId: 'random', size: 16 });
    session.play();
    await session.pause();
    await loading;
    await new Promise((r) => setTimeout(r, 20));
    expect(session.playing).toBe(false);
    expect(created[0].generation).toBe(0);
  });
  it('drops traces from a superseded engine', async () => {
    const onTrace = vi.fn();
    const created: FakeEngine[] = [];
    const session = new Session({
      createEngine: () => {
        const e = new FakeEngine();
        e.stepDelayMs = 30;
        e.traceBatches = [{ kind: 'gpu', samples: new Float64Array(0), lost: 0 }];
        created.push(e);
        return e;
      },
      buildGrid: (_p, size) => createGrid(size),
      onFrame: () => {},
      onStats: () => {},
      onError: () => {},
      onTrace,
    });
    await session.load({ engineId: 'a', presetId: 'random', size: 16 });
    const step = session.step();
    await session.load({ engineId: 'b', presetId: 'random', size: 16 });
    await step;
    expect(onTrace).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest'
import { createGrid, hashCells, liveCount, type Grid } from '../../web/src/grid'
import { lifeStep } from '../src/sim/life'
import { SimTrack, seedGrid } from '../src/sim/track'

function setCells(g: Grid, pts: [number, number][]): Grid {
  for (const [x, y] of pts) g.cells[y * g.size + x] = 1
  return g
}

function liveSet(g: Grid): string {
  const out: string[] = []
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i]) out.push(`${i % g.size},${Math.floor(i / g.size)}`)
  return out.sort().join(';')
}

function run(g: Grid, n: number): Grid {
  for (let i = 0; i < n; i++) g = lifeStep(g)
  return g
}

describe('lifeStep', () => {
  it('blinker has period 2', () => {
    const g = setCells(createGrid(8), [[3, 2], [3, 3], [3, 4]])
    const one = lifeStep(g)
    expect(liveSet(one)).toBe('2,3;3,3;4,3')
    expect(liveSet(lifeStep(one))).toBe(liveSet(g))
  })

  it('glider is the same shape shifted (+1,+1) after 4 generations', () => {
    const pts: [number, number][] = [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]]
    const g = setCells(createGrid(16), pts)
    const moved = setCells(createGrid(16), pts.map(([x, y]) => [x + 1, y + 1]))
    expect(liveSet(run(g, 4))).toBe(liveSet(moved))
  })

  it('keeps border cells dead and does not mutate its input', () => {
    const g = createGrid(5)
    g.cells.fill(1)
    const before = g.cells.slice()
    const next = lifeStep(g)
    expect(g.cells).toEqual(before)
    for (let i = 0; i < 5; i++) {
      expect(next.cells[i]).toBe(0)
      expect(next.cells[20 + i]).toBe(0)
      expect(next.cells[i * 5]).toBe(0)
      expect(next.cells[i * 5 + 4]).toBe(0)
    }
  })

  it('writes into a provided output grid', () => {
    const g = setCells(createGrid(8), [[3, 2], [3, 3], [3, 4]])
    const out = createGrid(8)
    expect(lifeStep(g, out)).toBe(out)
    expect(liveSet(out)).toBe('2,3;3,3;4,3')
  })
})

describe('seedGrid', () => {
  it('diehard is alive at gen 129 and dead at gen 130', () => {
    const t = new SimTrack(() => seedGrid('diehard', 64))
    expect(liveCount(t.at(129).cells)).toBeGreaterThan(0)
    expect(liveCount(t.at(130).cells)).toBe(0)
  })

  it('throws when the grid is smaller than the preset minSize', () => {
    expect(() => seedGrid('guns', 64)).toThrow()
  })
})

describe('SimTrack', () => {
  const seed = () => seedGrid('random', 64)

  it('is deterministic when rewinding', () => {
    const t = new SimTrack(seed)
    hashCells(t.at(100).cells)
    const rewound = hashCells(t.at(50).cells)
    expect(rewound).toBe(hashCells(new SimTrack(seed).at(50).cells))
  })

  it('matches stepping by hand and supports out-of-order access', () => {
    const t = new SimTrack(seed)
    const h = (g: Grid) => hashCells(g.cells)
    let ref = seed()
    const hashes: string[] = [h(ref)]
    for (let i = 0; i < 20; i++) hashes.push(h((ref = lifeStep(ref))))
    for (const gen of [20, 3, 3, 0, 17, 18, 5]) expect(h(t.at(gen))).toBe(hashes[gen])
  })

  it('rejects negative or fractional generations', () => {
    const t = new SimTrack(seed)
    expect(() => t.at(-1)).toThrow()
    expect(() => t.at(1.5)).toThrow()
  })
})

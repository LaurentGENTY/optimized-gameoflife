import { describe, expect, it } from 'vitest'
import { engineColor, heat } from '../src/render/palette'

describe('palette', () => {
  it('ramps from CPU cyan to GPU orange through violet and magenta', () => {
    expect(heat(0)).toBe('#4cc9f0')
    expect(heat(1 / 3)).toBe('#b14cff')
    expect(heat(2 / 3)).toBe('#ff3d81')
    expect(heat(1)).toBe('#ff9e3d')
  })

  it('clamps outside [0, 1]', () => {
    expect(heat(-1)).toBe('#4cc9f0')
    expect(heat(2)).toBe('#ff9e3d')
  })

  it('colours engines by speed rank', () => {
    expect(engineColor('webgpu-naive')).toBe('#ff9e3d')
    expect(engineColor('native-seq')).toBe('#4cc9f0')
  })
})

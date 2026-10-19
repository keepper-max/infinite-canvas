import * as THREE from 'three'
import { CATEGORY_HEX } from './data'

// Presentation-only palette: preserve category hue and identity, never rewrite source data.
export const STAGE = '#091f32'
export const CATEGORY_COLORS = CATEGORY_HEX.map(hex => {
  const hsl = new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 })
  return new THREE.Color().setHSL(hsl.h, Math.min(.62, hsl.s * .8), .57)
})
export const DISPLAY_HEX = CATEGORY_COLORS.map(color => `#${color.getHexString()}`)
export const displayScale = (scale: number) => Math.sqrt(scale) * .68

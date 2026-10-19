import * as THREE from 'three'
import { CATEGORY_HEX, CATEGORY_GROUPS } from './data'

// Presentation-only palette: preserve category hue and identity, never rewrite source data.
export const STAGE = '#071b2d'
export const CATEGORY_COLORS = CATEGORY_HEX.map((_, i) => {
  const hue = CATEGORY_GROUPS[i] === 'D' ? .66 : CATEGORY_GROUPS[i] === 'B' ? .53 : .57
  return new THREE.Color().setHSL(hue+(i%3)*.012,.31,.59)
})
export const DISPLAY_HEX = CATEGORY_COLORS.map(color => `#${color.getHexString()}`)
export const displayScale = (scale: number) => Math.sqrt(scale) * .68

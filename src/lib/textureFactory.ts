import * as THREE from 'three'
import { toCanvas } from 'html-to-image'

export async function elementToTexture(
  element: HTMLElement,
  pixelRatio = 2,
  backgroundColor = '#ffffff',
) {
  const canvas = await toCanvas(element, {
    pixelRatio,
    backgroundColor,
    cacheBust: true,
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

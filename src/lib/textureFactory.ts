import * as THREE from 'three'
import { toCanvas } from 'html-to-image'

export async function elementToTexture(element: HTMLElement, pixelRatio = 2) {
  const canvas = await toCanvas(element, {
    pixelRatio,
    backgroundColor: '#ffffff',
    cacheBust: true,
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

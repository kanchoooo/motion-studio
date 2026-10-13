// Brand kits shared by every project on this computer (app data folder).
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { BrandPreset } from '@shared/brief'
import { dataDir } from './paths'
import { newId, readJson, writeJson } from './util'

const file = () => join(dataDir(), 'brands.json')
export const listBrands = () => readJson<BrandPreset[]>(file(), [])

export function saveBrand(input: Omit<BrandPreset, 'id'> & { id?: string }, logoSource?: string): BrandPreset {
  const list = listBrands()
  const id = input.id ?? newId().slice(0, 12)
  let logo = input.logo
  if (logoSource) {
    const dir = join(dataDir(), 'brands', id)
    mkdirSync(dir, { recursive: true })
    logo = join(dir, `logo${extname(logoSource).toLowerCase()}`)
    copyFileSync(logoSource, logo)
  }
  const brand: BrandPreset = { ...input, id, logo }
  const i = list.findIndex((b) => b.id === id)
  if (i >= 0) list[i] = brand
  else list.push(brand)
  writeJson(file(), list)
  return brand
}

export function removeBrand(id: string) {
  writeJson(file(), listBrands().filter((b) => b.id !== id))
  rmSync(join(dataDir(), 'brands', id), { recursive: true, force: true })
}

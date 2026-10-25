const IMAGE_EXT_LIST = [
  '.jpg',
  '.jpeg',
  '.jfif',
  '.png',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif'
]

// 这些 RAW 格式都是 TIFF/容器结构，内部带有 JPEG 预览
const RAW_EXT_LIST = [
  '.nef',
  '.nrw',
  '.cr2',
  '.cr3',
  '.arw',
  '.srf',
  '.sr2',
  '.dng',
  '.orf',
  '.raf',
  '.rw2',
  '.pef',
  '.x3f',
  '.3fr',
  '.erf',
  '.kdc',
  '.mrw',
  '.srw',
  '.rwl',
  '.iiq',
  '.cap',
  '.dcr'
]

export const IMAGE_EXT = new Set(IMAGE_EXT_LIST)
export const RAW_EXT = new Set(RAW_EXT_LIST)
// sharp 的预编译包不带 HEVC 解码，HEIC/HEIF 要走系统图像编解码兜底
export const HEIF_EXT = new Set(['.heic', '.heif'])
export const SUPPORTED_EXT = new Set([...IMAGE_EXT_LIST, ...RAW_EXT_LIST])
export const SUPPORTED_EXT_LIST = [...IMAGE_EXT_LIST, ...RAW_EXT_LIST]

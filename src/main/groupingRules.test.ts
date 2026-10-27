import { describe, expect, it } from 'vitest'
import {
  BURST_GAP_MS,
  burstKeyOf,
  buildGroupPlans,
  cameraOf,
  pairBaseKey,
  type GroupRow
} from './groupingRules'

const T0 = 1_700_000_000_000

/** 造一行测试数据，只写关心的字段 */
function row(over: Partial<GroupRow> & { id: number }): GroupRow {
  return {
    path: `E:/照片/IMG_${over.id}.jpg`,
    ext: '.jpg',
    mtime: T0,
    rating: 0,
    exif: JSON.stringify({ camera: 'Nikon Zf' }),
    is_raw: 0,
    pair_key: null,
    pair_cover: 0,
    burst_key: null,
    burst_cover: 0,
    stack_id: null,
    stack_cover: 0,
    ...over
  }
}

describe('cameraOf', () => {
  it('取出机身名并去掉空白', () => {
    expect(cameraOf(JSON.stringify({ camera: '  Nikon Zf ' }))).toBe('Nikon Zf')
  })

  it('空值、坏 JSON、空机身名都返回 null', () => {
    expect(cameraOf(null)).toBeNull()
    expect(cameraOf('{bad json')).toBeNull()
    expect(cameraOf(JSON.stringify({}))).toBeNull()
    expect(cameraOf(JSON.stringify({ camera: '   ' }))).toBeNull()
  })
})

describe('pairBaseKey', () => {
  it('目录与主名统一小写，扩展名不参与', () => {
    expect(pairBaseKey('E:/Photos/IMG_01.NEF')).toBe(pairBaseKey('E:/photos/img_01.jpg'))
  })

  it('不同目录即使同名也不同组', () => {
    expect(pairBaseKey('E:/a/IMG_01.jpg')).not.toBe(pairBaseKey('E:/b/IMG_01.jpg'))
  })
})

describe('RAW + JPEG 配对', () => {
  it('同目录同主名合成一组，RAW 当封面', () => {
    const plans = buildGroupPlans([
      row({ id: 1, path: 'E:/照片/DSC_0001.nef', ext: '.nef' }),
      row({ id: 2, path: 'E:/照片/DSC_0001.jpg', ext: '.jpg' })
    ])
    const raw = plans.get(1)!
    const jpg = plans.get(2)!
    expect(raw.isRaw).toBe(1)
    expect(jpg.isRaw).toBe(0)
    expect(raw.pairKey).not.toBeNull()
    expect(raw.pairKey).toBe(jpg.pairKey)
    expect(raw.pairCover).toBe(1)
    expect(jpg.pairCover).toBe(0)
  })

  it('只有普通图不配对', () => {
    const plans = buildGroupPlans([row({ id: 1 }), row({ id: 2 })])
    expect(plans.get(1)!.pairKey).toBeNull()
    expect(plans.get(1)!.pairCover).toBe(0)
  })

  it('只有 RAW 也不配对', () => {
    const plans = buildGroupPlans([
      row({ id: 1, path: 'E:/照片/DSC_1.nef', ext: '.nef' }),
      row({ id: 2, path: 'E:/照片/DSC_2.nef', ext: '.nef' })
    ])
    expect(plans.get(1)!.pairKey).toBeNull()
  })

  it('扩展名大小写不影响配对', () => {
    const plans = buildGroupPlans([
      row({ id: 1, path: 'E:/照片/DSC_0002.NEF', ext: '.NEF' }),
      row({ id: 2, path: 'E:/照片/dsc_0002.JPG', ext: '.JPG' })
    ])
    expect(plans.get(1)!.pairKey).toBe(plans.get(2)!.pairKey)
    expect(plans.get(1)!.pairCover).toBe(1)
  })

  it('多张 RAW 时取 id 最小的当封面，副件也留在组里', () => {
    const plans = buildGroupPlans([
      row({ id: 4, path: 'E:/照片/DSC_3.nef', ext: '.nef' }),
      row({ id: 3, path: 'E:/照片/DSC_3.nef', ext: '.nef' }),
      row({ id: 9, path: 'E:/照片/DSC_3.jpg', ext: '.jpg' })
    ])
    const key = plans.get(3)!.pairKey
    expect(key).not.toBeNull()
    expect(plans.get(4)!.pairKey).toBe(key)
    expect(plans.get(9)!.pairKey).toBe(key)
    expect(plans.get(3)!.pairCover).toBe(1)
    expect(plans.get(4)!.pairCover).toBe(0)
    expect(plans.get(9)!.pairCover).toBe(0)
  })
})

describe('连拍堆叠', () => {
  const burstRow = (id: number, offsetMs: number, rating = 0, camera = 'Nikon Zf'): GroupRow =>
    row({
      id,
      path: `E:/照片/burst_${id}.jpg`,
      mtime: T0 + offsetMs,
      rating,
      exif: JSON.stringify({ camera })
    })

  it('同机身、间隔在 2 秒内且满 3 张才成组，封面取评分最高', () => {
    const plans = buildGroupPlans([
      burstRow(1, 0, 1),
      burstRow(2, 500, 5),
      burstRow(3, 1000, 3)
    ])
    const key = plans.get(1)!.burstKey
    expect(key).not.toBeNull()
    expect(plans.get(2)!.burstKey).toBe(key)
    expect(plans.get(3)!.burstKey).toBe(key)
    expect(plans.get(2)!.burstCover).toBe(1)
    expect(plans.get(1)!.burstCover).toBe(0)
    expect(key).toBe('b1')
  })

  it('只有 2 张不成组', () => {
    const plans = buildGroupPlans([burstRow(1, 0), burstRow(2, 500)])
    expect(plans.get(1)!.burstKey).toBeNull()
    expect(plans.get(2)!.burstKey).toBeNull()
  })

  it('间隔超过 2 秒就断开', () => {
    const plans = buildGroupPlans([
      burstRow(1, 0),
      burstRow(2, BURST_GAP_MS + 500),
      burstRow(3, BURST_GAP_MS + 800)
    ])
    for (const id of [1, 2, 3]) expect(plans.get(id)!.burstKey).toBeNull()
  })

  it('机身不同不合并', () => {
    const plans = buildGroupPlans([
      burstRow(1, 0, 0, 'Nikon Zf'),
      burstRow(2, 300, 0, 'OPPO Find X8 Ultra'),
      burstRow(3, 600, 0, 'Nikon Zf')
    ])
    for (const id of [1, 2, 3]) expect(plans.get(id)!.burstKey).toBeNull()
  })

  it('没有机身信息时宁可不成组', () => {
    const noCamera = (id: number, offsetMs: number): GroupRow =>
      row({ id, path: `E:/照片/x_${id}.jpg`, mtime: T0 + offsetMs, exif: null })
    const plans = buildGroupPlans([noCamera(1, 0), noCamera(2, 300), noCamera(3, 600)])
    for (const id of [1, 2, 3]) expect(plans.get(id)!.burstKey).toBeNull()
  })

  it('拍摄时间未知的行自己不参与连拍，也不影响其它组', () => {
    const plans = buildGroupPlans([
      burstRow(1, 0),
      row({ id: 2, path: 'E:/照片/no_time.jpg', mtime: 0 }),
      burstRow(3, 500),
      burstRow(4, 900)
    ])
    // mtime 为 0 会排到最前并被跳过，自己不成组
    expect(plans.get(2)!.burstKey).toBeNull()
    // 其余三张照常成组
    const key = plans.get(1)!.burstKey
    expect(key).toBe('b1')
    expect(plans.get(3)!.burstKey).toBe(key)
    expect(plans.get(4)!.burstKey).toBe(key)
  })

  it('手动堆叠里的成员不参与自动连拍', () => {
    const plans = buildGroupPlans([
      burstRow(1, 0),
      { ...burstRow(2, 400), stack_id: 7 },
      burstRow(3, 800)
    ])
    expect(plans.get(2)!.burstKey).toBeNull()
    expect(plans.get(1)!.burstKey).toBeNull()
  })

  it('配对里的副件跟着封面进同一个连拍组', () => {
    const plans = buildGroupPlans([
      row({ id: 1, path: 'E:/照片/DSC_1.nef', ext: '.nef', mtime: T0 }),
      row({ id: 2, path: 'E:/照片/DSC_1.jpg', ext: '.jpg', mtime: T0 }),
      row({ id: 3, path: 'E:/照片/DSC_2.jpg', ext: '.jpg', mtime: T0 + 500 }),
      row({ id: 4, path: 'E:/照片/DSC_3.jpg', ext: '.jpg', mtime: T0 + 900 })
    ])
    const key = plans.get(1)!.burstKey
    expect(key).not.toBeNull()
    expect(plans.get(3)!.burstKey).toBe(key)
    expect(plans.get(4)!.burstKey).toBe(key)
    // 副件同组但不是封面
    expect(plans.get(2)!.burstKey).toBe(key)
    expect(plans.get(2)!.burstCover).toBe(0)
  })
})

describe('burstKeyOf', () => {
  it('用组内最早一张的 id 生成，便于排查', () => {
    expect(burstKeyOf(42)).toBe('b42')
  })
})

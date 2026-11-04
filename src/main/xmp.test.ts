import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd() }
}))

const { buildXmp } = await import('./xmp')

describe('buildXmp', () => {
  it('写星级、旗标双写、备注与参考片标记', () => {
    const xml = buildXmp({
      rating: 4,
      flag: 1,
      note: '客户要的封面图',
      reference: true,
      keywords: ['街头'],
      hierarchical: ['景别|特写']
    })
    expect(xml).toContain('xmp:Rating="4"')
    expect(xml).toContain('xmp:Label="青色"')
    expect(xml).toContain('moonphoto:Flag="pick"')
    expect(xml).toContain('moonphoto:Reference="1"')
    expect(xml).toContain('<rdf:li>街头</rdf:li>')
    expect(xml).toContain('<rdf:li>景别|特写</rdf:li>')
    expect(xml).toContain('客户要的封面图')
  })

  it('淘汰用红色，空集合不生成空节点', () => {
    const xml = buildXmp({
      rating: 0,
      flag: -1,
      note: '',
      reference: false,
      keywords: [],
      hierarchical: []
    })
    expect(xml).toContain('xmp:Rating="0"')
    expect(xml).toContain('xmp:Label="红色"')
    expect(xml).toContain('moonphoto:Flag="reject"')
    expect(xml).not.toContain('dc:subject')
    expect(xml).not.toContain('dc:description')
    expect(xml).not.toContain('moonphoto:Reference')
  })

  it('标签里的 XML 特殊字符会被转义', () => {
    const xml = buildXmp({
      rating: 3,
      flag: 0,
      note: '',
      reference: false,
      keywords: ['A&B <咖啡> "店"'],
      hierarchical: []
    })
    expect(xml).toContain('A&amp;B &lt;咖啡&gt; &quot;店&quot;')
    expect(xml).not.toContain('<rdf:li>A&B')
  })
})

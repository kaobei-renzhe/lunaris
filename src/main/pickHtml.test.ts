import { describe, expect, it } from 'vitest'
import { buildPickHtml } from './pickHtml'

const shots = [
  { seq: 1, width: 800, height: 1200, b64: 'AAAA' },
  { seq: 2, width: 1200, height: 800, b64: 'BBBB' }
]

describe('buildPickHtml', () => {
  it('把图片数据与短码写进页面，页面不依赖外部资源', () => {
    const html = buildPickHtml({ token: 'k3m9pq2x', title: '小林 · 街拍', client: '王女士', shots })
    expect(html).toContain('"b64":"AAAA"')
    expect(html).toContain('data:image/jpeg;base64,')
    expect(html).toContain("var KEY = 'pick:' + META.token")
    expect(html).toContain('k3m9pq2x')
    expect(html).toContain('这一组共 2 张')
    // 自包含：除了 SVG 命名空间，不应有任何外部链接
    expect(html.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:\/\//)
  })

  it('标题与客户名里的 HTML 会被转义，不能提前闭合脚本', () => {
    const html = buildPickHtml({
      token: 't',
      title: '<img src=x onerror=alert(1)>',
      client: '</script><script>alert(2)</script>',
      shots
    })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;/script&gt;')
    expect(html).not.toContain('</script><script>alert(2)')
  })

  it('数据里的 < 被转成 Unicode 转义，不会截断 JSON', () => {
    const html = buildPickHtml({ token: 't', title: 'a</script>b', client: '', shots })
    expect(html).toContain('\\u003c/script')
  })

  it('客户可以在页面上写备注，并带进生成的清单', () => {
    const html = buildPickHtml({ token: 't', title: '选片', client: '王女士', shots })
    expect(html).toContain('id="note"')
    expect(html).toContain('想说的可以写在这里')
    expect(html).toContain("lines.push('备注：')")
    expect(html).toContain('（无）')
  })

  it('客户为空时不出现空的「客户：」行', () => {
    const html = buildPickHtml({ token: 't', title: '选片', client: '', shots })
    expect(html).toContain("if (META.client) lines.push('客户：' + META.client)")
    expect(html).toContain('这一组共 2 张')
  })
})

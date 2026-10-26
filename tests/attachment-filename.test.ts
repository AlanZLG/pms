import { describe, it, expect } from 'vitest'
import { fixMojibake } from '../api/routes/attachments.ts'

// multer/busboy 默认按 latin1 解码 multipart filename，中文文件名（UTF-8 字节流）
// 会变成 latin1 乱码（如「文本」→「ææ¬」）。fixMojibake 需在多种输入下保持正确。
describe('fixMojibake 附件文件名乱码还原', () => {
  it('latin1 乱码 → 还原为 UTF-8 中文', () => {
    const mojibake = Buffer.from('运维方案.xlsx', 'utf8').toString('latin1')
    expect(mojibake).not.toBe('运维方案.xlsx') // 乱码确实发生了
    expect(fixMojibake(mojibake)).toBe('运维方案.xlsx')
  })

  it('真实场景：库里已入库的乱码附件名（pl_sql_文本改成对应编码_261022.xlsx）', () => {
    const mojibake = Buffer.from('pl_sql_文本改成对应编码_261022.xlsx', 'utf8').toString('latin1')
    expect(fixMojibake(mojibake)).toBe('pl_sql_文本改成对应编码_261022.xlsx')
  })

  it('已是正确 UTF-8 中文（含非 latin1 字符）→ 原样保留', () => {
    expect(fixMojibake('运维方案.xlsx')).toBe('运维方案.xlsx')
    expect(fixMojibake('需求文档（终稿）v2.pdf')).toBe('需求文档（终稿）v2.pdf')
  })

  it('纯 ASCII 文件名 → 原样保留', () => {
    expect(fixMojibake('report-2026-10-22.xlsx')).toBe('report-2026-10-22.xlsx')
    expect(fixMojibake('')).toBe('')
  })

  it('latin1 范围内但非 UTF-8 字节流（如 0xFF）→ 保留原值不产生替换符', () => {
    // 'ab\u00FF' 按 latin1 还原字节 [0x61,0x62,0xFF]，0xFF 不是合法 UTF-8 起始字节
    expect(fixMojibake('ab\u00FF')).toBe('ab\u00FF')
  })
})

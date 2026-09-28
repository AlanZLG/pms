import { describe, it, expect } from 'vitest'
import { SYSTEM_TEMPLATE_DEFS, validateTemplateDefs } from '../api/lib/systemTemplates.ts'

// 模板不变量守护（v1.9.3，v1.9.4 扩为 6 个）：系统模板的内部初始设置必须始终满足结构合法性
// 曾发生的问题：客户支持模板缺失初始预算——本测试防止同类漂移再次发生
describe('系统模板定义不变量（6 个模板的初始设置合理性守护）', () => {
  it('不变量校验全部通过', () => {
    expect(validateTemplateDefs()).toEqual([])
  })

  it('系统模板数量与名称齐全', () => {
    expect(SYSTEM_TEMPLATE_DEFS.map((d) => d.name)).toEqual([
      '新规开发模板',
      '产品迭代模板',
      '客户支持模板',
      '咨询服务模板',
      '实施交付模板',
      '软著申请模板',
    ])
  })

  it('每个模板都有初始预算且包含人力成本', () => {
    for (const d of SYSTEM_TEMPLATE_DEFS) {
      expect(d.budgets.length, `${d.name} 应有初始预算`).toBeGreaterThan(0)
      expect(d.budgets.some((b) => b.category === 'labor'), `${d.name} 初始预算应包含人力成本`).toBe(true)
    }
  })

  it('每个模板的看板列覆盖全部四个系统状态', () => {
    for (const d of SYSTEM_TEMPLATE_DEFS) {
      const keys = d.columns.map((c) => c.statusKey).sort()
      expect(keys, d.name).toEqual(['done', 'in_progress', 'review', 'todo'])
    }
  })

  it('模板任务链路完整：每个模板至少 5 个任务且描述非空', () => {
    for (const d of SYSTEM_TEMPLATE_DEFS) {
      expect(d.tasks.length, `${d.name} 任务数`).toBeGreaterThanOrEqual(5)
      for (const t of d.tasks) {
        expect(t.title.trim(), `${d.name} 任务标题`).not.toBe('')
        expect(t.description.trim(), `${d.name} 任务「${t.title}」描述`).not.toBe('')
      }
    }
  })

  it('分类与项目类型白名单同源（v1.8.6 归一化口径）', () => {
    expect(Object.fromEntries(SYSTEM_TEMPLATE_DEFS.map((d) => [d.name, d.category]))).toEqual({
      新规开发模板: '开发项目',
      产品迭代模板: '产品迭代',
      客户支持模板: '运维项目',
      咨询服务模板: '咨询项目',
      实施交付模板: '实施项目',
      软著申请模板: '知识产权',
    })
  })

  it('软著申请模板任务描述覆盖登记资料清单关键项（v1.9.4）', () => {
    const def = SYSTEM_TEMPLATE_DEFS.find((d) => d.name === '软著申请模板')!
    expect(def).toBeDefined()
    const all = def.tasks.map((t) => `${t.title} ${t.description}`).join('\n')
    // 资料清单核心关键词：申请表、源程序（页数规则）、说明书、身份证明、权属文件、受理跟进
    const keywords = ['申请表', '前 30 页', '后 30 页', '50 行', '说明书', '营业执照', '权属', '受理', '补正', '归档']
    for (const k of keywords) {
      expect(all).toContain(k)
    }
  })
})

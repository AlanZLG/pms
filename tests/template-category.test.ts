// v1.8.6 模板分类归一化与类型映射测试
import { describe, it, expect } from 'vitest'
import {
  TEMPLATE_CATEGORIES,
  normalizeTemplateCategory,
  TEMPLATE_CATEGORY_DEFAULT_TYPE,
  PROJECT_TYPES,
} from '../shared/types'

describe('模板分类 normalizeTemplateCategory', () => {
  it('五个合法分类均通过并原样返回', () => {
    for (const c of TEMPLATE_CATEGORIES) {
      expect(normalizeTemplateCategory(c)).toBe(c)
    }
  })

  it('首尾空白自动去除', () => {
    expect(normalizeTemplateCategory(' 产品迭代 ')).toBe('产品迭代')
  })

  it('非法值返回 null', () => {
    expect(normalizeTemplateCategory('运营项目')).toBeNull()
    expect(normalizeTemplateCategory('other')).toBeNull()
  })

  it('空串与非字符串返回 null', () => {
    expect(normalizeTemplateCategory('')).toBeNull()
    expect(normalizeTemplateCategory('   ')).toBeNull()
    expect(normalizeTemplateCategory(null)).toBeNull()
    expect(normalizeTemplateCategory(undefined)).toBeNull()
    expect(normalizeTemplateCategory(456)).toBeNull()
  })

  it('常量清单与项目类型同名（六类，v1.9.0 含运维增强）', () => {
    expect([...TEMPLATE_CATEGORIES]).toEqual(['运维项目', '开发项目', '咨询项目', '实施项目', '产品迭代', '运维增强'])
  })
})

describe('模板分类 → 默认项目类型映射', () => {
  it('五分类与项目类型同名一一对应', () => {
    expect(TEMPLATE_CATEGORY_DEFAULT_TYPE['运维项目']).toBe('运维项目')
    expect(TEMPLATE_CATEGORY_DEFAULT_TYPE['开发项目']).toBe('开发项目')
    expect(TEMPLATE_CATEGORY_DEFAULT_TYPE['咨询项目']).toBe('咨询项目')
    expect(TEMPLATE_CATEGORY_DEFAULT_TYPE['实施项目']).toBe('实施项目')
    expect(TEMPLATE_CATEGORY_DEFAULT_TYPE['产品迭代']).toBe('产品迭代')
  })

  it('映射后的项目类型均合法（命中 PROJECT_TYPES 白名单）', () => {
    for (const c of TEMPLATE_CATEGORIES) {
      expect(PROJECT_TYPES).toContain(TEMPLATE_CATEGORY_DEFAULT_TYPE[c])
    }
  })
})

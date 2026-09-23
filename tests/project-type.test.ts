// v1.8.7 项目类型归一化测试（v1.9.0 扩为六类：五类 + 运维增强）
import { describe, it, expect } from 'vitest'
import { PROJECT_TYPES, normalizeProjectType, projectLedgerLabel } from '../shared/types'

describe('项目类型 normalizeProjectType', () => {
  it('六种合法类型均通过并原样返回', () => {
    for (const t of PROJECT_TYPES) {
      expect(normalizeProjectType(t)).toBe(t)
    }
  })

  it('首尾空白自动去除', () => {
    expect(normalizeProjectType(' 运维项目 ')).toBe('运维项目')
    expect(normalizeProjectType(' 产品迭代 ')).toBe('产品迭代')
    expect(normalizeProjectType(' 运维增强 ')).toBe('运维增强')
  })

  it('非法值返回 null', () => {
    expect(normalizeProjectType('运营项目')).toBeNull()
    expect(normalizeProjectType('other')).toBeNull()
  })

  it('空串与非字符串返回 null', () => {
    expect(normalizeProjectType('')).toBeNull()
    expect(normalizeProjectType('   ')).toBeNull()
    expect(normalizeProjectType(null)).toBeNull()
    expect(normalizeProjectType(undefined)).toBeNull()
    expect(normalizeProjectType(123)).toBeNull()
  })

  it('常量清单恰好为六类（五类 + 运维增强）', () => {
    expect([...PROJECT_TYPES]).toEqual(['运维项目', '开发项目', '咨询项目', '实施项目', '产品迭代', '运维增强'])
  })
})

describe('台账入口名称 projectLedgerLabel', () => {
  it('运维项目与运维增强显示「运维台账」', () => {
    expect(projectLedgerLabel('运维项目')).toBe('运维台账')
    expect(projectLedgerLabel('运维增强')).toBe('运维台账')
  })

  it('其余类型显示「课题表」', () => {
    expect(projectLedgerLabel('开发项目')).toBe('课题表')
    expect(projectLedgerLabel('咨询项目')).toBe('课题表')
    expect(projectLedgerLabel('实施项目')).toBe('课题表')
    expect(projectLedgerLabel('产品迭代')).toBe('课题表')
  })

  it('未设置类型显示「课题表」', () => {
    expect(projectLedgerLabel(null)).toBe('课题表')
    expect(projectLedgerLabel(undefined)).toBe('课题表')
  })
})

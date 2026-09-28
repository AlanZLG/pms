// 系统预设模板定义（v1.9.3）：纯数据模块，无 DB 副作用
// 供 db.ts 初始化与 tests/template-invariants.test.ts 守护测试共用，改模板先改这里

export type TemplateTaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TemplateTaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TemplateBudgetCategory = 'labor' | 'outsource' | 'hardware' | 'software' | 'other'

export interface SystemTemplateTaskDef {
  title: string
  description: string
  status: TemplateTaskStatus
  priority: TemplateTaskPriority
  labels: string[]
}

export interface SystemTemplateBudgetDef {
  category: TemplateBudgetCategory
  description: string
}

export interface SystemTemplateColumnDef {
  statusKey: TemplateTaskStatus
  label: string
  color: string
}

export interface SystemTemplateDef {
  name: string
  description: string
  category: string
  /** sort_order 按数组下标生成 */
  tasks: SystemTemplateTaskDef[]
  budgets: SystemTemplateBudgetDef[]
  columns: SystemTemplateColumnDef[]
}

const DEFAULT_COLUMNS: SystemTemplateColumnDef[] = [
  { statusKey: 'todo', label: '待办', color: '#94A3B8' },
  { statusKey: 'in_progress', label: '进行中', color: '#F59E0B' },
  { statusKey: 'review', label: '审核中', color: '#0EA5E9' },
  { statusKey: 'done', label: '已完成', color: '#10B981' },
]

export const SYSTEM_TEMPLATE_DEFS: SystemTemplateDef[] = [
  {
    name: '新规开发模板',
    description: '适用于新规开发项目的标准流程模板',
    category: '开发项目',
    tasks: [
      { title: '需求分析与调研', description: '收集用户需求，进行竞品分析', status: 'todo', priority: 'high', labels: ['需求'] },
      { title: '原型设计', description: '设计产品原型和交互流程', status: 'todo', priority: 'high', labels: ['设计'] },
      { title: 'UI设计', description: '视觉设计和设计稿输出', status: 'todo', priority: 'high', labels: ['设计'] },
      { title: '前端开发', description: '前端页面开发与交互实现', status: 'todo', priority: 'high', labels: ['前端'] },
      { title: '后端开发', description: '后端API开发与数据库设计', status: 'todo', priority: 'high', labels: ['后端'] },
      { title: '功能测试', description: '功能测试和Bug修复', status: 'todo', priority: 'medium', labels: ['测试'] },
      { title: '性能优化', description: '性能优化和代码审查', status: 'todo', priority: 'medium', labels: ['优化'] },
      { title: '上线部署', description: '部署上线和监控配置', status: 'todo', priority: 'high', labels: ['运维'] },
    ],
    budgets: [
      { category: 'labor', description: '人力成本' },
      { category: 'software', description: '软件工具' },
    ],
    columns: DEFAULT_COLUMNS,
  },
  {
    name: '产品迭代模板',
    description: '适用于产品迭代更新的敏捷开发模板',
    category: '产品迭代',
    tasks: [
      { title: '版本规划', description: '确定版本目标和功能范围', status: 'todo', priority: 'high', labels: ['规划'] },
      { title: '功能开发', description: '新功能开发与实现', status: 'todo', priority: 'high', labels: ['开发'] },
      { title: '功能测试', description: '新功能测试和回归测试', status: 'todo', priority: 'high', labels: ['测试'] },
      { title: '灰度发布', description: '灰度发布和监控', status: 'todo', priority: 'medium', labels: ['发布'] },
      { title: '全量发布', description: '全量发布和公告', status: 'todo', priority: 'medium', labels: ['发布'] },
    ],
    budgets: [{ category: 'labor', description: '人力成本' }],
    columns: DEFAULT_COLUMNS,
  },
  {
    name: '客户支持模板',
    description: '适用于客户支持和问题处理的模板',
    category: '运维项目',
    tasks: [
      { title: '问题接收', description: '接收客户问题和需求', status: 'todo', priority: 'high', labels: ['支持'] },
      { title: '问题分析', description: '分析问题原因和解决方案', status: 'todo', priority: 'high', labels: ['分析'] },
      { title: '方案实施', description: '实施解决方案', status: 'todo', priority: 'medium', labels: ['实施'] },
      { title: '客户反馈', description: '收集客户反馈和确认', status: 'todo', priority: 'medium', labels: ['反馈'] },
      { title: '问题关闭', description: '问题解决并关闭', status: 'todo', priority: 'low', labels: ['关闭'] },
    ],
    // v1.9.3 补齐：此前该模板是唯一没有初始预算的系统模板，支持类项目同样产生人力工时
    budgets: [{ category: 'labor', description: '人力成本' }],
    columns: [
      { statusKey: 'todo', label: '待处理', color: '#94A3B8' },
      { statusKey: 'in_progress', label: '处理中', color: '#F59E0B' },
      { statusKey: 'review', label: '待确认', color: '#0EA5E9' },
      { statusKey: 'done', label: '已关闭', color: '#10B981' },
    ],
  },
  {
    name: '咨询服务模板',
    description: '适用于咨询服务类项目的标准流程模板',
    category: '咨询项目',
    tasks: [
      { title: '需求调研与诊断', description: '访谈调研，梳理业务现状与痛点', status: 'todo', priority: 'high', labels: ['调研'] },
      { title: '方案框架设计', description: '设计咨询方案框架与交付物清单', status: 'todo', priority: 'high', labels: ['设计'] },
      { title: '方案评审与确认', description: '与客户评审方案并确认调整', status: 'todo', priority: 'high', labels: ['评审'] },
      { title: '咨询交付实施', description: '输出报告与方案，辅导落地', status: 'todo', priority: 'medium', labels: ['交付'] },
      { title: '成果汇报验收', description: '成果汇报与客户验收', status: 'todo', priority: 'medium', labels: ['验收'] },
      { title: '复盘与知识沉淀', description: '项目复盘，沉淀方法论与经验', status: 'todo', priority: 'low', labels: ['复盘'] },
    ],
    budgets: [
      { category: 'labor', description: '人力成本' },
      { category: 'outsource', description: '外部专家' },
    ],
    columns: [
      { statusKey: 'todo', label: '待办', color: '#94A3B8' },
      { statusKey: 'in_progress', label: '进行中', color: '#F59E0B' },
      { statusKey: 'review', label: '评审中', color: '#0EA5E9' },
      { statusKey: 'done', label: '已完成', color: '#10B981' },
    ],
  },
  {
    name: '实施交付模板',
    description: '适用于项目实施交付的标准流程模板',
    category: '实施项目',
    tasks: [
      { title: '进场准备', description: '组建实施团队，确认进场计划与物料清单', status: 'todo', priority: 'high', labels: ['准备'] },
      { title: '环境部署', description: '搭建生产/测试环境，完成系统安装配置', status: 'todo', priority: 'high', labels: ['部署'] },
      { title: '数据迁移', description: '历史数据清洗、导入与核对', status: 'todo', priority: 'high', labels: ['数据'] },
      { title: '用户培训', description: '培训管理员与最终用户，输出操作手册', status: 'todo', priority: 'medium', labels: ['培训'] },
      { title: '试运行', description: '试运行期伴随保障，问题收集与处理', status: 'todo', priority: 'medium', labels: ['试运行'] },
      { title: '上线切换', description: '正式切换上线，制定回滚预案', status: 'todo', priority: 'high', labels: ['上线'] },
      { title: '验收移交', description: '验收签字，文档移交与结项', status: 'todo', priority: 'medium', labels: ['验收'] },
    ],
    budgets: [
      { category: 'labor', description: '人力成本' },
      { category: 'hardware', description: '硬件设备' },
    ],
    columns: [
      { statusKey: 'todo', label: '待办', color: '#94A3B8' },
      { statusKey: 'in_progress', label: '进行中', color: '#F59E0B' },
      { statusKey: 'review', label: '待验收', color: '#0EA5E9' },
      { statusKey: 'done', label: '已完成', color: '#10B981' },
    ],
  },
  {
    // v1.9.4 新增：软著申报事务型流程，资料清单提示写入各任务描述，建项目后照单准备
    name: '软著申请模板',
    description: '适用于软件著作权登记申报，任务描述内置登记材料清单（源程序、说明书、申请表等）',
    category: '知识产权',
    tasks: [
      { title: '软著信息确认', description: '确认软件全称、版本号（V1.0）、开发完成日期、首次发表日期（未发表填「未发表」）；软件名称应与产品名称一致，避免过泛或夸大用词', status: 'todo', priority: 'high', labels: ['申报'] },
      { title: '源程序材料整理', description: '导出源程序前 30 页 + 后 30 页（每页不少于 50 行，总量不足 60 页的全部提交）；每页页眉标注「软件名称 + 版本号 + 页码」', status: 'todo', priority: 'high', labels: ['材料'] },
      { title: '说明书文档编写', description: '用户手册 / 操作手册 / 设计说明书任选其一，同样提交前 30 页 + 后 30 页，配界面截图；页眉标注格式与源程序一致', status: 'todo', priority: 'high', labels: ['材料'] },
      { title: '申请表填报与盖章', description: '登录中国版权保护中心官网填报《软件著作权登记申请表》，打印后加盖公章；填报信息须与源程序页眉、说明书保持一致', status: 'todo', priority: 'high', labels: ['申报'] },
      { title: '身份与权属材料准备', description: '企业申请：营业执照副本复印件加盖公章；个人申请：身份证复印件；如属委托开发 / 合作开发，另附权属协议或合同复印件', status: 'todo', priority: 'medium', labels: ['材料'] },
      { title: '提交与受理跟进', description: '在线提交或邮寄纸质材料，取得受理编号；跟进审查进度，一般 30-40 个工作日下证', status: 'todo', priority: 'medium', labels: ['跟进'] },
      { title: '补正处理（如有）', description: '收到补正通知书后须在 30 日内一次性提交全部补正材料，逾期视为撤回申请', status: 'todo', priority: 'medium', labels: ['跟进'] },
      { title: '证书归档', description: '收到证书后扫描存档，将证书号登记至课题表，原件妥善保管备查', status: 'todo', priority: 'low', labels: ['归档'] },
    ],
    budgets: [
      { category: 'labor', description: '人力成本（材料整理与填报工时）' },
      { category: 'other', description: '代理服务费（如委托代理机构；官方登记费 2017 年起免征）' },
    ],
    columns: DEFAULT_COLUMNS,
  },
]

/** 模板定义不变量校验：返回问题列表（空数组 = 全部通过） */
export function validateTemplateDefs(defs: SystemTemplateDef[] = SYSTEM_TEMPLATE_DEFS): string[] {
  const issues: string[] = []
  const TASK_STATUS: TemplateTaskStatus[] = ['todo', 'in_progress', 'review', 'done']
  const names = new Set<string>()

  for (const d of defs) {
    if (names.has(d.name)) issues.push(`[${d.name}] 模板名重复`)
    names.add(d.name)
    if (!d.description.trim()) issues.push(`[${d.name}] 缺少模板描述`)
    if (!d.category.trim()) issues.push(`[${d.name}] 缺少模板分类`)
    if (d.tasks.length === 0) issues.push(`[${d.name}] 未定义任何模板任务`)
    if (d.budgets.length === 0) issues.push(`[${d.name}] 未定义任何初始预算`)
    if (!d.budgets.some((b) => b.category === 'labor')) issues.push(`[${d.name}] 初始预算缺少人力成本(labor)`)

    d.tasks.forEach((t, i) => {
      if (!t.title.trim()) issues.push(`[${d.name}] 第 ${i} 个任务标题为空`)
      if (!t.description.trim()) issues.push(`[${d.name}] 任务「${t.title}」缺少描述`)
      if (!TASK_STATUS.includes(t.status)) issues.push(`[${d.name}] 任务「${t.title}」非法状态 ${t.status}`)
    })

    const keys = d.columns.map((c) => c.statusKey).slice().sort().join(',')
    if (keys !== 'done,in_progress,review,todo') issues.push(`[${d.name}] 看板列未覆盖全部系统状态: ${keys}`)
    for (const c of d.columns) if (!c.label.trim()) issues.push(`[${d.name}] 看板列 ${c.statusKey} 显示名为空`)
  }
  return issues
}

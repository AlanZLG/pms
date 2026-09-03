import { useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Plus, Edit2, Trash2, X, Check, XCircle } from 'lucide-react'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { Card, Button, Input } from '@/components/ui'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import type { ProjectBudget, ProjectExpense, BudgetCategory } from '../../shared/types'

const categoryLabels: Record<string, string> = {
  labor: '内部人力',
  outsource: '外包费用',
  hardware: '硬件设备',
  software: '软件服务',
  other: '其他',
}

const categoryColors: Record<string, string> = {
  labor: '#6366F1',
  outsource: '#F59E0B',
  hardware: '#38BDF8',
  software: '#10B981',
  other: '#94A3B8',
}

const approvalLabels: Record<string, string> = {
  pending: '待审批',
  approved: '已审批',
  rejected: '已拒绝',
}

interface BudgetPanelProps {
  projectId: string
}

export default function BudgetPanel({ projectId }: BudgetPanelProps) {
  const user = useAppStore((s) => s.user)
  const isFinance = user?.role === 'admin' || user?.role === 'finance'

  const [showBudgetModal, setShowBudgetModal] = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [editingBudget, setEditingBudget] = useState<ProjectBudget | null>(null)
  const [editingExpense, setEditingExpense] = useState<ProjectExpense | null>(null)
  const [approvingBudget, setApprovingBudget] = useState<ProjectBudget | null>(null)
  const [approveAction, setApproveAction] = useState<'approve' | 'reject'>('approve')
  const [approveComment, setApproveComment] = useState('')

  const budgets = useAsync<ProjectBudget[]>(() => api.listBudgets(projectId).then((r) => r.budgets), [projectId])
  const expenses = useAsync<ProjectExpense[]>(() => api.listExpenses(projectId).then((r) => r.expenses), [projectId])

  const filteredBudgets = isFinance ? budgets.data || [] : (budgets.data || []).filter(b => b.approvalStatus === 'approved')
  const totalBudget = filteredBudgets.reduce((sum, b) => sum + b.amount, 0) || 0
  const totalExpense = expenses.data?.reduce((sum, e) => sum + e.amount, 0) || 0
  const remaining = totalBudget - totalExpense

  const [form, setForm] = useState({
    category: 'labor' as BudgetCategory,
    amount: 0,
    description: '',
  })

  const [expenseForm, setExpenseForm] = useState({
    budgetId: '',
    category: 'labor' as BudgetCategory,
    amount: 0,
    description: '',
    date: new Date().toISOString().slice(0, 10),
  })

  const pieData = filteredBudgets.map((b) => ({
    name: categoryLabels[b.category],
    value: b.amount,
    color: categoryColors[b.category],
  }))

  const handleSaveBudget = async () => {
    if (editingBudget) {
      await api.updateBudget(editingBudget.id, form)
    } else {
      await api.createBudget(projectId, form)
    }
    setShowBudgetModal(false)
    setEditingBudget(null)
    setForm({ category: 'labor', amount: 0, description: '' })
    budgets.reload()
  }

  const handleSaveExpense = async () => {
    if (editingExpense) {
      await api.updateExpense(editingExpense.id, expenseForm)
    } else {
      await api.createExpense(projectId, expenseForm)
    }
    setShowExpenseModal(false)
    setEditingExpense(null)
    setExpenseForm({
      budgetId: '',
      category: 'labor',
      amount: 0,
      description: '',
      date: new Date().toISOString().slice(0, 10),
    })
    expenses.reload()
  }

  const handleDeleteBudget = async (budgetId: string) => {
    if (confirm('确定要删除这个预算项吗？')) {
      await api.deleteBudget(budgetId)
      budgets.reload()
    }
  }

  const handleDeleteExpense = async (expenseId: string) => {
    if (confirm('确定要删除这个支出记录吗？')) {
      await api.deleteExpense(expenseId)
      expenses.reload()
    }
  }

  const openBudgetEdit = (budget: ProjectBudget) => {
    setEditingBudget(budget)
    setForm({
      category: budget.category,
      amount: budget.amount,
      description: budget.description,
    })
    setShowBudgetModal(true)
  }

  const openExpenseEdit = (expense: ProjectExpense) => {
    setEditingExpense(expense)
    setExpenseForm({
      budgetId: expense.budgetId || '',
      category: expense.category,
      amount: expense.amount,
      description: expense.description,
      date: expense.date,
    })
    setShowExpenseModal(true)
  }

  const openApproveModal = (budget: ProjectBudget, action: 'approve' | 'reject') => {
    setApprovingBudget(budget)
    setApproveAction(action)
    setApproveComment('')
    setShowApproveModal(true)
  }

  const handleApprove = async () => {
    if (!approvingBudget) return
    if (approveAction === 'approve') {
      await api.approveBudget(approvingBudget.id, { comment: approveComment })
    } else {
      await api.rejectBudget(approvingBudget.id, { comment: approveComment })
    }
    setShowApproveModal(false)
    setApprovingBudget(null)
    setApproveComment('')
    budgets.reload()
  }

  const canEditBudget = (budget: ProjectBudget) => {
    if (budget.approvalStatus === 'approved') return false
    if (isFinance) return true
    return budget.createdBy === user?.id
  }

  const canDeleteBudget = (budget: ProjectBudget) => {
    if (budget.approvalStatus === 'approved') return false
    if (isFinance) return true
    return budget.createdBy === user?.id
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">总预算</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl text-brand-soft">¥</span>
            <span className="font-mono text-2xl font-semibold text-text-primary">{totalBudget.toLocaleString()}</span>
          </div>
          {!isFinance && budgets.data?.some(b => b.approvalStatus === 'pending') && (
            <div className="mt-1 text-xs text-warn">{budgets.data.filter(b => b.approvalStatus === 'pending').length} 项待审批</div>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">已支出</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl text-warn">¥</span>
            <span className="font-mono text-2xl font-semibold text-text-primary">{totalExpense.toLocaleString()}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted">剩余</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={cn('text-xl', remaining >= 0 ? 'text-success' : 'text-danger')}>¥</span>
            <span className={cn('font-mono text-2xl font-semibold', remaining >= 0 ? 'text-text-primary' : 'text-danger')}>
              {remaining.toLocaleString()}
            </span>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg text-text-primary">预算分配</h3>
            <Button size="sm" onClick={() => setShowBudgetModal(true)}>
              <Plus className="h-4 w-4 mr-1" /> 添加预算
            </Button>
          </div>
          {budgets.loading ? (
            <div className="h-48 flex items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : totalBudget === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-muted">
              <span className="text-4xl opacity-50">¥</span>
              <p className="text-sm">暂无预算数据</p>
            </div>
          ) : (
            <div className="flex gap-4">
              <div className="relative h-40 w-40 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      innerRadius={30}
                      outerRadius={60}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-lg font-semibold text-text-primary">{(totalBudget / 10000).toFixed(1)}万</span>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                {budgets.data?.map((b) => (
                  <div key={b.id} className={cn('flex items-center justify-between rounded-lg p-2', b.approvalStatus === 'pending' ? 'bg-warn/10 border border-warn/20' : 'bg-bg-soft')}>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: categoryColors[b.category] }} />
                      <span className="text-sm text-text-secondary">{categoryLabels[b.category]}</span>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-full',
                        b.approvalStatus === 'pending' ? 'bg-warn/20 text-warn' :
                        b.approvalStatus === 'approved' ? 'bg-success/20 text-success' :
                        'bg-danger/20 text-danger'
                      )}>
                        {approvalLabels[b.approvalStatus]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn('font-mono text-sm', b.approvalStatus !== 'approved' && !isFinance ? 'text-muted' : 'text-text-primary')}>
                        {b.approvalStatus !== 'approved' && !isFinance ? '***' : b.amount.toLocaleString()}
                      </span>
                      {canEditBudget(b) && (
                        <button onClick={() => openBudgetEdit(b)} className="p-1 text-muted hover:text-text-primary">
                          <Edit2 className="h-3 w-3" />
                        </button>
                      )}
                      {canDeleteBudget(b) && (
                        <button onClick={() => handleDeleteBudget(b.id)} className="p-1 text-muted hover:text-danger">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      {isFinance && b.approvalStatus === 'pending' && (
                        <>
                          <button onClick={() => openApproveModal(b, 'approve')} className="p-1 text-success hover:bg-success/10 rounded">
                            <Check className="h-3 w-3" />
                          </button>
                          <button onClick={() => openApproveModal(b, 'reject')} className="p-1 text-danger hover:bg-danger/10 rounded">
                            <XCircle className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-lg text-text-primary">支出记录</h3>
            <Button size="sm" onClick={() => setShowExpenseModal(true)}>
              <Plus className="h-4 w-4 mr-1" /> 添加支出
            </Button>
          </div>
          {expenses.loading ? (
            <div className="h-48 flex items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          ) : expenses.data?.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-muted">
              <span className="text-4xl opacity-50">¥</span>
              <p className="text-sm">暂无支出记录</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {expenses.data?.map((e) => (
                <div key={e.id} className="rounded-lg bg-bg-soft p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: categoryColors[e.category] }} />
                      <span className="text-sm text-text-secondary">{categoryLabels[e.category]}</span>
                      <span className="text-xs text-muted">{e.date}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-warn">{e.amount.toLocaleString()}</span>
                      <button onClick={() => openExpenseEdit(e)} className="p-1 text-muted hover:text-text-primary">
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button onClick={() => handleDeleteExpense(e.id)} className="p-1 text-muted hover:text-danger">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {e.description && (
                    <p className="mt-1 text-xs text-muted">{e.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {showBudgetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-text-primary">{editingBudget ? '编辑预算' : '添加预算'}</h3>
              <button onClick={() => setShowBudgetModal(false)} className="p-1 text-muted hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs text-muted">预算分类</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value as BudgetCategory })}
                  className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
                >
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted">预算金额</label>
                <Input
                  type="number"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  min="0"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted">备注说明</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="请输入备注说明"
                />
              </div>
              {!isFinance && (
                <div className="rounded-lg bg-warn/10 p-3 text-xs text-warn">
                  提交后需等待财务人员审批
                </div>
              )}
            </div>
            <div className="mt-6">
              <Button onClick={handleSaveBudget} className="w-full">
                {editingBudget ? '保存修改' : '创建预算'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-text-primary">{editingExpense ? '编辑支出' : '添加支出'}</h3>
              <button onClick={() => setShowExpenseModal(false)} className="p-1 text-muted hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs text-muted">关联预算</label>
                <select
                  value={expenseForm.budgetId}
                  onChange={(e) => setExpenseForm({ ...expenseForm, budgetId: e.target.value })}
                  className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
                >
                  <option value="">不关联</option>
                  {filteredBudgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {categoryLabels[b.category]} - {b.amount.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted">支出分类</label>
                <select
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value as BudgetCategory })}
                  className="w-full rounded-lg border border-bg-border bg-bg-soft px-3 py-2 text-sm text-text-primary outline-none focus:border-brand"
                >
                  {Object.entries(categoryLabels).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted">支出金额</label>
                <Input
                  type="number"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm({ ...expenseForm, amount: parseFloat(e.target.value) || 0 })}
                  placeholder="0"
                  min="0"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted">支出日期</label>
                <Input
                  type="date"
                  value={expenseForm.date}
                  onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted">备注说明</label>
                <Input
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                  placeholder="请输入备注说明"
                />
              </div>
            </div>
            <div className="mt-6">
              <Button onClick={handleSaveExpense} className="w-full">
                {editingExpense ? '保存修改' : '创建支出'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showApproveModal && approvingBudget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-bg-border bg-bg-panel p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-text-primary">
                {approveAction === 'approve' ? '审批预算' : '拒绝预算'}
              </h3>
              <button onClick={() => setShowApproveModal(false)} className="p-1 text-muted hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-bg-soft p-3">
                <div className="text-xs text-muted">预算分类</div>
                <div className="mt-1 text-sm text-text-primary">{categoryLabels[approvingBudget.category]}</div>
              </div>
              <div className="rounded-lg bg-bg-soft p-3">
                <div className="text-xs text-muted">预算金额</div>
                <div className="mt-1 text-lg font-mono text-text-primary">¥{approvingBudget.amount.toLocaleString()}</div>
              </div>
              {approvingBudget.description && (
                <div className="rounded-lg bg-bg-soft p-3">
                  <div className="text-xs text-muted">备注说明</div>
                  <div className="mt-1 text-sm text-text-primary">{approvingBudget.description}</div>
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs text-muted">审批意见（可选）</label>
                <Input
                  value={approveComment}
                  onChange={(e) => setApproveComment(e.target.value)}
                  placeholder="请输入审批意见..."
                />
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" onClick={() => setShowApproveModal(false)} className="flex-1">取消</Button>
              <Button onClick={handleApprove} className={cn('flex-1', approveAction === 'approve' ? 'bg-success hover:bg-success/80' : 'bg-danger hover:bg-danger/80')}>
                {approveAction === 'approve' ? '确认审批' : '确认拒绝'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
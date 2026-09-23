import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用内存数据库 mock api/db.ts
vi.mock('../api/db.ts', async () => {
  const { createTestDb } = await import('./helpers/test-db')
  const db = createTestDb()
  return { default: db }
})

import db from '../api/db.ts'
import { taskRepo, subtaskRepo, projectRepo } from '../api/repository/repo.ts'
import { seedUser, seedProject, seedTask, seedSubtask } from './helpers/test-db'

/**
 * 子任务与任务状态联动测试
 *
 * 覆盖规则:
 * 1. 所有子任务完成 → 任务自动置为 done
 * 2. 取消子任务完成且任务为 done → 任务回退为 in_progress
 * 3. 任务手动置为 done → 自动完成所有子任务 (markAllDone)
 * 4. recalcProgress 按子任务完成比例计算进度
 */
describe('子任务与任务状态联动', () => {
  let userId: string
  let projectId: string
  let taskId: string

  beforeEach(() => {
    db.prepare('DELETE FROM subtasks').run()
    db.prepare('DELETE FROM tasks').run()
    db.prepare('DELETE FROM project_members').run()
    db.prepare('DELETE FROM projects').run()
    db.prepare('DELETE FROM users').run()

    userId = seedUser(db, { name: '联动测试用户', role: 'admin' })
    projectId = seedProject(db, userId, { name: '联动测试项目' })
    taskId = seedTask(db, projectId, { title: '联动测试任务', status: 'todo' })
  })

  describe('子任务全完成 → 任务自动 done', () => {
    it('两个子任务全部完成时，任务应自动变为 done', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })
      const sub2 = seedSubtask(db, taskId, { title: '子2' })

      // 完成子任务1
      subtaskRepo.update(sub1, { done: true })
      applyStatusLinkage(taskId)

      let task = taskRepo.findById(taskId)!
      expect(task.status).toBe('todo') // 还有一个未完成

      // 完成子任务2
      subtaskRepo.update(sub2, { done: true })
      applyStatusLinkage(taskId)

      task = taskRepo.findById(taskId)!
      expect(task.status).toBe('done')
    })

    it('部分子任务完成时任务不应变为 done', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })
      seedSubtask(db, taskId, { title: '子2' })

      subtaskRepo.update(sub1, { done: true })
      applyStatusLinkage(taskId)

      const task = taskRepo.findById(taskId)!
      expect(task.status).not.toBe('done')
    })

    it('单个子任务完成时任务应变为 done', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })

      subtaskRepo.update(sub1, { done: true })
      applyStatusLinkage(taskId)

      const task = taskRepo.findById(taskId)!
      expect(task.status).toBe('done')
    })

    it('无子任务时不应触发 done', () => {
      applyStatusLinkage(taskId)
      const task = taskRepo.findById(taskId)!
      expect(task.status).toBe('todo')
    })
  })

  describe('取消子任务完成 → 任务回退 in_progress', () => {
    it('任务为 done 时取消子任务完成应回退为 in_progress', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })
      const sub2 = seedSubtask(db, taskId, { title: '子2' })

      // 全部完成 → 任务 done
      subtaskRepo.update(sub1, { done: true })
      subtaskRepo.update(sub2, { done: true })
      applyStatusLinkage(taskId)
      expect(taskRepo.findById(taskId)!.status).toBe('done')

      // 取消子任务1完成
      subtaskRepo.update(sub1, { done: false })
      applyStatusLinkage(taskId)

      const task = taskRepo.findById(taskId)!
      expect(task.status).toBe('in_progress')
    })

    it('任务非 done 时取消子任务完成不应触发回退', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })
      seedSubtask(db, taskId, { title: '子2' })

      // 只完成一个 → 任务仍为 todo
      subtaskRepo.update(sub1, { done: true })
      applyStatusLinkage(taskId)
      expect(taskRepo.findById(taskId)!.status).toBe('todo')

      // 取消完成 → 任务仍为 todo (不回退)
      subtaskRepo.update(sub1, { done: false })
      applyStatusLinkage(taskId)
      expect(taskRepo.findById(taskId)!.status).toBe('todo')
    })
  })

  describe('任务手动置 done → 自动完成所有子任务 (markAllDone)', () => {
    it('任务置为 done 时所有未完成子任务应被标记完成', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })
      const sub2 = seedSubtask(db, taskId, { title: '子2', done: true })
      const sub3 = seedSubtask(db, taskId, { title: '子3' })

      // 任务手动置为 done
      taskRepo.updateStatus(taskId, 'done')
      subtaskRepo.markAllDone(taskId)

      const subs = subtaskRepo.findByTask(taskId)
      expect(subs.find((s) => s.id === sub1)!.done).toBe(true)
      expect(subs.find((s) => s.id === sub2)!.done).toBe(true)
      expect(subs.find((s) => s.id === sub3)!.done).toBe(true)
    })

    it('markAllDone 应是幂等操作', () => {
      seedSubtask(db, taskId, { title: '子1', done: true })

      subtaskRepo.markAllDone(taskId)
      subtaskRepo.markAllDone(taskId) // 再调一次不应报错

      const subs = subtaskRepo.findByTask(taskId)
      expect(subs.every((s) => s.done)).toBe(true)
    })

    it('任务从 done 回退到 in_progress 时不影响子任务完成状态', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })

      // 任务 → done → 子任务全完成
      taskRepo.updateStatus(taskId, 'done')
      subtaskRepo.markAllDone(taskId)
      expect(subtaskRepo.findByTask(taskId).every((s) => s.done)).toBe(true)

      // 任务回退到 in_progress
      taskRepo.updateStatus(taskId, 'in_progress')
      // 子任务仍应保持完成（不自动取消）
      expect(subtaskRepo.findByTask(taskId).find((s) => s.id === sub1)!.done).toBe(true)
    })
  })

  describe('recalcProgress 进度计算', () => {
    it('任务 done 时进度应为 100', () => {
      seedSubtask(db, taskId, { title: '子1' })
      taskRepo.updateStatus(taskId, 'done')

      const progress = taskRepo.recalcProgress(taskId)
      expect(progress).toBe(100)
    })

    it('有子任务时进度按完成比例计算', () => {
      seedSubtask(db, taskId, { title: '子1' })
      seedSubtask(db, taskId, { title: '子2' })
      seedSubtask(db, taskId, { title: '子3' })
      seedSubtask(db, taskId, { title: '子4' })

      // 完成 1/4 → 25%
      const subs = subtaskRepo.findByTask(taskId)
      subtaskRepo.update(subs[0].id, { done: true })

      const progress = taskRepo.recalcProgress(taskId)
      expect(progress).toBe(25)

      // 完成 2/4 → 50%
      subtaskRepo.update(subs[1].id, { done: true })
      const progress2 = taskRepo.recalcProgress(taskId)
      expect(progress2).toBe(50)

      // 全部完成 → 100%
      subtaskRepo.update(subs[2].id, { done: true })
      subtaskRepo.update(subs[3].id, { done: true })
      const progress3 = taskRepo.recalcProgress(taskId)
      expect(progress3).toBe(100)
    })

    it('无子任务且状态为 todo 时进度应为 0', () => {
      const progress = taskRepo.recalcProgress(taskId)
      expect(progress).toBe(0)
    })

    it('无子任务且状态为 in_progress 时进度保持手动值', () => {
      // 手动设置进度为 50
      db.prepare('UPDATE tasks SET progress = 50 WHERE id = ?').run(taskId)
      taskRepo.updateStatus(taskId, 'in_progress')

      const progress = taskRepo.recalcProgress(taskId)
      expect(progress).toBe(50)
    })
  })

  describe('项目进度级联', () => {
    it('子任务完成应级联更新项目进度', () => {
      const sub1 = seedSubtask(db, taskId, { title: '子1' })
      const sub2 = seedSubtask(db, taskId, { title: '子2' })

      // 完成1个 → 50%
      subtaskRepo.update(sub1, { done: true })
      applyStatusLinkage(taskId)
      projectRepo.updateProgress(projectId)

      let project = projectRepo.findById(projectId)!
      expect(project.progress).toBe(50)

      // 全部完成 → 100% (且任务 done)
      subtaskRepo.update(sub2, { done: true })
      applyStatusLinkage(taskId)
      projectRepo.updateProgress(projectId)

      project = projectRepo.findById(projectId)!
      expect(project.progress).toBe(100)
    })

    it('任务全部删除后，项目进度应归零而不是残留历史值', () => {
      // 任务进度 50% → 项目进度 50%
      db.prepare('UPDATE tasks SET progress = 50 WHERE id = ?').run(taskId)
      projectRepo.updateProgress(projectId)
      expect(projectRepo.findById(projectId)!.progress).toBe(50)

      // 任务软删除（从统计中排除）→ 空项目进度归零
      db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), taskId)
      projectRepo.updateProgress(projectId)
      expect(projectRepo.findById(projectId)!.progress).toBe(0)
    })

    it('从未有过任务的项目调用 updateProgress 不报错且保持 0', () => {
      const emptyProjectId = seedProject(db, userId, { name: '空项目' })
      projectRepo.updateProgress(emptyProjectId)
      expect(projectRepo.findById(emptyProjectId)!.progress).toBe(0)
    })

    it('completed 项目即使无任务进度也保持 100', () => {
      const doneProjectId = seedProject(db, userId, { name: '完结项目', status: 'completed' })
      projectRepo.updateProgress(doneProjectId)
      expect(projectRepo.findById(doneProjectId)!.progress).toBe(100)
    })
  })
})

/**
 * 复刻 api/routes/tasks.ts 中子任务更新后的状态联动逻辑。
 * 仅用于单元测试，不依赖 Express 路由。
 */
function applyStatusLinkage(taskId: string): void {
  const task = taskRepo.findById(taskId)
  if (!task) return
  const subs = subtaskRepo.findByTask(task.id)
  const currentTask = taskRepo.findById(task.id)!

  // 所有子任务完成 → 自动将任务标记为 done
  if (subs.length > 0 && subs.every((s) => s.done) && currentTask.status !== 'done') {
    taskRepo.updateStatus(task.id, 'done')
  }

  // 有子任务未完成但任务是 done → 回退为 in_progress
  if (subs.length > 0 && !subs.every((s) => s.done) && currentTask.status === 'done') {
    taskRepo.updateStatus(task.id, 'in_progress')
  }

  taskRepo.recalcProgress(task.id)
}

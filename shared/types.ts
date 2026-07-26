// 前后端共享的类型定义

export type UserRole = 'admin' | 'owner' | 'member' | 'guest'
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'archived'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface User {
  id: string
  email: string
  name: string
  avatarColor: string
  role: UserRole
  createdAt: string
}

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  ownerId: string
  members: ProjectMember[]
  progress: number
  dueDate: string | null
  createdAt: string
}

export interface ProjectMember {
  userId: string
  role: MemberRole
  joinedAt: string
  user?: { name: string; avatarColor: string; email: string }
}

export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string | null
  labels: string[]
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

export interface Comment {
  id: string
  taskId: string
  userId: string
  userName: string
  avatarColor: string
  content: string
  createdAt: string
}

export interface Subtask {
  id: string
  taskId: string
  title: string
  done: boolean
  createdAt: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface StatsOverview {
  totalProjects: number
  activeProjects: number
  completedProjects: number
  overdueProjects: number
  tasksByStatus: { todo: number; in_progress: number; review: number; done: number }
  trend: { date: string; completed: number; created: number }[]
}

export interface BurndownData {
  dates: string[]
  ideal: number[]
  actual: number[]
}

export interface WorkloadItem {
  userId: string
  userName: string
  avatarColor: string
  total: number
  done: number
  inProgress: number
}
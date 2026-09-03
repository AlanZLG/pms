import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { User } from '../../shared/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getUserSortOrder(u: User | undefined): number {
  if (!u) return 99
  if (u.role === 'admin') return 0
  if (u.role === 'finance') return 1
  if (u.isOutsourced) return 4
  return 3
}

export function sortUsers(users: User[]): User[] {
  return [...users].sort((a, b) => {
    const orderA = getUserSortOrder(a)
    const orderB = getUserSortOrder(b)
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })
}

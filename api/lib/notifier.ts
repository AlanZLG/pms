import { userRepo } from '../repository/repo.js'
import { sendMessage } from './feishu.js'
import type { Notification } from '../../shared/types.js'

export function pushFeishuNotification(
  userId: string,
  type: Notification['type'],
  title: string,
  body?: string,
) {
  try {
    const user = userRepo.findById(userId)
    if (!user?.feishuOpenId) return
    sendMessage(user.feishuOpenId, title, body || title).catch(e => {
      console.warn('[feishu] 推送失败:', e)
    })
  } catch (e) {
    console.warn('[feishu] 查询用户失败:', e)
  }
}
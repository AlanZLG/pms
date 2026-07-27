import nodemailer from 'nodemailer'
import dotenv from 'dotenv'

dotenv.config()

let transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (transporter) return transporter
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '587')
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) {
    return null
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
  return transporter
}

export async function sendMail(to: string, subject: string, html: string) {
  const t = getTransporter()
  if (!t) {
    console.warn('[mail] SMTP 未配置,跳过邮件发送')
    return false
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || `Atlas <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    })
    return true
  } catch (e) {
    console.error('[mail] 发送失败:', e)
    return false
  }
}

export function taskCompleteEmail(taskTitle: string, projectName: string, userName: string) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #6366F1, #8B5CF6); border-radius: 12px 12px 0 0; padding: 24px; color: white;">
        <h2 style="margin: 0; font-size: 20px;">任务已完成 ✅</h2>
      </div>
      <div style="background: #F8FAFC; border-radius: 0 0 12px 12px; padding: 24px; border: 1px solid #E2E8F0;">
        <p style="margin: 0 0 16px 0; color: #334155;">
          <strong>${userName}</strong>,你负责的任务已完成!
        </p>
        <div style="background: white; border-radius: 8px; padding: 16px; border: 1px solid #E2E8F0;">
          <div style="margin-bottom: 8px;">
            <span style="color: #64748B; font-size: 14px;">项目:</span>
            <span style="color: #1E293B; font-size: 14px; margin-left: 8px;">${projectName}</span>
          </div>
          <div>
            <span style="color: #64748B; font-size: 14px;">任务:</span>
            <span style="color: #1E293B; font-size: 14px; margin-left: 8px; font-weight: 500;">${taskTitle}</span>
          </div>
        </div>
        <p style="margin-top: 24px; color: #64748B; font-size: 13px;">
          此邮件由 Atlas 项目管理系统自动发送,请勿直接回复。
        </p>
      </div>
    </div>
  `
}
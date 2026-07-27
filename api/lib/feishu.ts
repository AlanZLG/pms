import dotenv from 'dotenv'

dotenv.config()

const APP_ID = process.env.FEISHU_APP_ID || ''
const APP_SECRET = process.env.FEISHU_APP_SECRET || ''
const REDIRECT_URI = process.env.FEISHU_REDIRECT_URI || ''

let cachedToken: { token: string; expires: number } | null = null

function isConfigured(): boolean {
  return !!(APP_ID && APP_SECRET)
}

export function getConfig() {
  return {
    appId: APP_ID,
    appSecret: APP_SECRET,
    redirectUri: REDIRECT_URI,
    configured: isConfigured(),
  }
}

export function getAuthUrl(state: string = ''): string {
  if (!REDIRECT_URI || !APP_ID) return ''
  const params = new URLSearchParams({
    app_id: APP_ID,
    redirect_uri: REDIRECT_URI,
    state,
    scope: 'contact:user.base:readonly im:message',
  })
  return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`
}

async function getTenantToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expires > Date.now()) {
    return cachedToken.token
  }
  if (!isConfigured()) return null
  try {
    const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
    })
    const data = await resp.json()
    if (data.code !== 0) {
      console.error('[feishu] 获取 tenant_access_token 失败:', data.msg)
      return null
    }
    cachedToken = {
      token: data.tenant_access_token,
      expires: Date.now() + (data.expire - 300) * 1000,
    }
    return cachedToken.token
  } catch (e) {
    console.error('[feishu] 获取 tenant_access_token 异常:', e)
    return null
  }
}

export async function exchangeCodeForUser(code: string): Promise<{ openId: string; unionId: string; name: string } | null> {
  const token = await getTenantToken()
  if (!token) return null
  try {
    const resp = await fetch('https://open.feishu.cn/open-apis/authen/v1/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ grant_type: 'authorization_code', code }),
    })
    const data = await resp.json()
    if (data.code !== 0) {
      console.error('[feishu] code 交换失败:', data.msg)
      return null
    }
    return {
      openId: data.data.open_id,
      unionId: data.data.union_id,
      name: data.data.name,
    }
  } catch (e) {
    console.error('[feishu] code 交换异常:', e)
    return null
  }
}

export async function sendMessage(openId: string, title: string, content: string): Promise<boolean> {
  const token = await getTenantToken()
  if (!token) {
    console.warn('[feishu] 未配置,跳过飞书消息发送')
    return false
  }
  try {
    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: title },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: { tag: 'plain_text', content },
        },
      ],
    }
    const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        receive_id: openId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    })
    const data = await resp.json()
    if (data.code !== 0) {
      console.error('[feishu] 消息发送失败:', data.msg)
      return false
    }
    return true
  } catch (e) {
    console.error('[feishu] 消息发送异常:', e)
    return false
  }
}
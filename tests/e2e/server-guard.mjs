// e2e 服务守护包装器
//
// 职责：托管 api/server.ts 子进程树，确保测试进程无论如何退出（正常结束、崩溃、被 Ctrl+C、
// 甚至被 SIGKILL 强杀），API 服务都不会成为孤儿进程残留。
//
// 关键点：tsx 是双层进程（tsx CLI 会再 spawn 内层 node），直接 SIGKILL 外层会把内层
// node 孤儿化——必须以「独立进程组 + 负 PID 组杀」整树终止。
//
// 机制：
//  1. 以 detached: true 启动服务，使其独立成进程组；
//  2. 每秒检查父进程（vitest）是否已退出——孤儿会被系统 reparent 到 pid 1，
//     检测到 ppid === 1 立即组杀整个服务进程树并自杀；
//  3. 转发 SIGTERM/SIGINT 为组杀（server.close() 会等待 keep-alive 连接而悬挂，
//     温和关闭不可靠）；
//  4. 极端情况（包装器自身被 SIGKILL）遗留的孤儿由测试 beforeAll 清扫兜底
//     （按 FORTUNE_DB_PATH 环境变量识别，绝不误伤生产服务）。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

const server = spawn(path.join(ROOT, 'node_modules/.bin/tsx'), ['api/server.ts'], {
  cwd: ROOT,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})

// 组杀整个服务进程树（tsx CLI + 内层 node）；-PID 表示按进程组杀
function killTree() {
  try {
    if (server.pid) process.kill(-server.pid, 'SIGKILL')
  } catch {
    // 进程组已退出，忽略
  }
  try {
    server.kill('SIGKILL')
  } catch {
    // 已退出，忽略
  }
}

const guard = setInterval(() => {
  if (process.ppid === 1) {
    // 父进程（vitest）已死亡：组杀服务进程树，防止孤儿残留
    killTree()
    clearInterval(guard)
    process.exit(1)
  }
}, 1000)

server.on('exit', (code) => {
  clearInterval(guard)
  process.exit(code ?? 0)
})

process.on('SIGTERM', () => {
  killTree()
})

process.on('SIGINT', () => {
  killTree()
  process.exit(1)
})

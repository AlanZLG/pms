# Atlas 项目管理系统

<div align="center">

**Atlas** · 一款轻量级的团队项目管理 Web 应用

[![Version](https://img.shields.io/badge/version-v1.1.0-blue)](./package.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![SQLite](https://img.shields.io/badge/database-SQLite-lightgrey)](https://www.sqlite.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![Express](https://img.shields.io/badge/Express-4-4169E1?logo=express)](https://expressjs.com/)

*看板驱动 · 数据可见 · 协作闭环 · 开箱即用*

</div>

---

## ✨ 功能特性

### 核心模块
- **看板视图** - 四列看板（待办 / 进行中 / 审核中 / 已完成），拖拽更新状态
- **列表视图** - 表格展示，支持多状态筛选与批量操作
- **任务管理** - 任务 CRUD、优先级、标签、截止日期、负责人指派
- **子任务/检查清单** - 将大任务拆分为可追踪的小步骤
- **评论系统** - 任务级评论 + 系统流水记录

### 协作增强 (v1.1)
- **@提及** - 评论中 @成员自动补全，被提及者收到通知
- **任务模板** - 预定义任务模板，一键创建，支持保存为模板
- **任务附件** - 上传/下载/删除文件附件（最大 20MB）
- **批量操作** - 多选任务批量改状态、改负责人、删除
- **通知中心** - 下拉快捷查看 + 独立历史页，支持类型筛选
- **邮件通知** - 任务完成自动发送邮件（Nodemailer + SMTP）

### 数据与统计
- **CSV 导出** - 项目列表与项目任务导出为 CSV（UTF-8 BOM）
- **数据统计** - 任务状态分布、14天趋势、燃尽图、成员工作量
- **项目管理** - 项目 CRUD、进度自动计算、创建时指定负责人

### 权限体系
- **四级角色** - 系统管理员 / 项目负责人 / 团队成员 / 访客
- **JWT 鉴权** - 安全登录与会话管理
- **数据隔离** - 按角色过滤可见数据

---

## 🛠️ 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 18 · TypeScript · Vite 6 | SPA 单页应用 |
| 样式 | TailwindCSS 3 | 原子化 CSS |
| 状态 | Zustand 5 | 轻量状态管理 |
| 拖拽 | @dnd-kit/core 6 | 现代化拖拽 |
| 图表 | Recharts 2 | 数据可视化 |
| 后端 | Express 4 · TypeScript | REST API |
| 数据库 | SQLite · better-sqlite3 | 单文件存储 |
| 认证 | JWT · bcrypt | 安全鉴权 |
| 校验 | Zod | 运行时类型安全 |
| 文件 | multer | 附件上传 |
| 邮件 | Nodemailer | 邮件通知 |

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/AlanZLG/pms.git
cd pms

# 安装依赖
npm install

# 同时启动前后端开发服务（推荐）
npm run dev

# 或分别启动
npm run server:dev    # 后端 API: http://localhost:3001
npm run client:dev    # 前端 Web: http://localhost:5173
```

打开浏览器访问 http://localhost:5173 即可使用。

### 生产构建

```bash
npm run build
```

产物位于 `dist/` 目录，可部署到任意静态托管服务。

---

## 🔑 演示账号

系统内置 5 个演示账号，**密码统一为 `123456`**：

| 角色 | 邮箱 | 说明 |
|------|------|------|
| 管理员 | `admin@pm.dev` | 全系统管理权限 |
| 负责人 | `owner@pm.dev` | 项目负责人 |
| 成员甲 | `member1@pm.dev` | 团队成员 |
| 成员乙 | `member2@pm.dev` | 团队成员 |
| 访客 | `guest@pm.dev` | 只读访问 |

> ⚠️ 首次启动自动创建数据库与演示数据。重置方法：删除 `data/app.db` 后重启。

---

## ⚙️ 环境变量

复制 `.env.example` 为 `.env` 并按需配置：

```bash
cp .env.example .env
```

```env
# 服务端口
PORT=3001

# JWT 密钥（生产环境务必修改）
JWT_SECRET=pm-dev-secret-change-me

# 邮件通知（可选，未配置则跳过邮件）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=your-email@qq.com
SMTP_PASS=your-smtp-auth-code
SMTP_FROM=Atlas <your-email@qq.com>
```

> 邮件配置参考 `.env.example` 中的常见邮箱 SMTP 配置表。

---

## 📁 项目结构

```
atlas-pms/
├── api/                          # 后端代码
│   ├── app.ts                    # Express 应用配置
│   ├── db.ts                     # 数据库连接 + 建表 + 种子
│   ├── lib/
│   │   ├── auth.ts               # JWT 认证中间件
│   │   ├── mail.ts               # 邮件发送（Nodemailer）
│   │   └── utils.ts              # 工具函数
│   ├── repository/
│   │   └── repo.ts               # 数据仓库层
│   └── routes/
│       ├── auth.ts               # 认证路由
│       ├── projects.ts           # 项目路由
│       ├── tasks.ts              # 任务路由
│       ├── stats.ts              # 统计路由
│       ├── team.ts               # 团队路由
│       ├── notifications.ts      # 通知路由
│       ├── templates.ts          # 任务模板路由
│       ├── attachments.ts        # 附件路由
│       └── export.ts             # CSV 导出路由
│
├── src/                          # 前端代码
│   ├── components/               # 通用组件
│   ├── pages/                    # 页面
│   │   ├── Dashboard.tsx         # 仪表板
│   │   ├── Projects.tsx          # 项目列表
│   │   ├── ProjectDetail.tsx     # 项目详情
│   │   ├── Stats.tsx             # 统计分析
│   │   ├── Team.tsx              # 团队协作
│   │   ├── Notifications.tsx     # 通知历史页
│   │   ├── Settings.tsx          # 个人设置
│   │   └── Login.tsx             # 登录/注册
│   ├── stores/                   # Zustand 状态管理
│   ├── lib/                      # API 客户端
│   └── hooks/                    # 自定义 Hooks
│
├── shared/
│   └── types.ts                  # 前后端共享类型
├── data/                         # SQLite 数据库 + 附件
├── docs/                         # 文档
├── .env.example                  # 环境变量模板
└── package.json
```

---

## 📚 文档

| 文档 | 说明 |
|------|------|
| [操作手册](docs/操作手册.md) | 用户操作指南，涵盖所有功能的使用方法 |
| [概要设计书](docs/概要设计书.md) | 系统架构设计、API 接口、数据库设计 |

---

## 🗺️ 演进路线

- ✅ **v1.0** - 四大核心模块、用户认证、通知中心、子任务
- ✅ **v1.1** - 批量操作、@提及、任务模板、任务附件、邮件通知、CSV 导出
- 🔜 **v1.2+** - 自定义角色、富文本评论、任务回收站、实时协作

---

## 📝 License

MIT © Atlas Project

*让每一次推进，都被看见*
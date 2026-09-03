# Fortune 项目管理系统

<div align="center">

**Fortune PM** · 一款轻量级的团队项目管理 Web 应用

[![Version](https://img.shields.io/badge/version-v1.3.0-blue)](./package.json)
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
- **甘特图视图** - 时间线可视化，任务条拖拽调整、依赖线（FS/SS/FF/SF）、关键路径高亮、进度拖拽
- **列表视图** - 表格展示，支持多状态筛选与批量操作
- **任务管理** - 任务 CRUD、优先级、标签、截止日期、负责人指派、进度百分比
- **子任务/检查清单** - 将大任务拆分为可追踪的小步骤
- **评论系统** - 任务级评论 + 系统流水记录 + 操作历史自动记录

### 协作增强 (v1.1)
- **@提及** - 评论中 @成员自动补全，被提及者收到通知
- **任务模板** - 预定义任务模板，一键创建，支持保存为模板
- **任务附件** - 上传/下载/删除文件附件（最大 20MB）
- **批量操作** - 多选任务批量改状态、改负责人、删除
- **通知中心** - 下拉快捷查看 + 独立历史页，支持类型筛选
- **邮件通知** - 任务完成自动发送邮件（Nodemailer + SMTP）

### 甘特图增强 (v1.1)
- **时间线视图** - 日/周/月三级缩放，键盘 `+/-` 快速调整
- **进度拖拽** - 悬停任务条边缘拖拽，实时调整完成百分比
- **依赖关系** - SVG 贝塞尔曲线连接，支持 FS/SS/FF/SF 四种类型
- **关键路径** - CPM 算法自动计算，红色边框高亮关键任务
- **泳道分组** - 按负责人分组，可折叠/展开
- **键盘快捷键** - `+/-` 缩放、`D` 回到今天、`G` 切换分组、`Esc` 取消
- **任务搜索** - 工具栏搜索框实时过滤

### 数据与统计
- **CSV 导出** - 项目列表与项目任务导出为 CSV（UTF-8 BOM）
- **进度 Excel** - 甘特图格式的进度导出（ExcelJS）
- **数据统计** - 任务状态分布、14天趋势、燃尽图、成员工作量
- **项目管理** - 项目 CRUD、进度自动计算、创建时指定负责人
- **操作历史** - 任务变更（状态/负责人/进度/日期）自动记录

### 权限体系
- **五级角色** - 系统管理员 / 财务人员 / 项目负责人 / 团队成员 / 访客
- **JWT 鉴权** - 安全登录与会话管理
- **数据隔离** - 按角色过滤可见数据
- **预算审批** - 预算需管理员或财务审批方可生效

### 财务与预算 (v1.2)
- **预算管理** - 项目预算 CRUD，支持人工/外包/硬件/软件/其他五类预算
- **预算审批** - 待审批/已批准/已驳回状态，仅管理员和财务可审批
- **支出登记** - 按预算类别登记支出，实时监控预算使用
- **成本统计** - 项目成本汇总，预算 vs 支出对比
- **成员成本** - 时薪设置、外包标记、成本中心分类

### 工时管理 (v1.2)
- **任务工时** - 每个任务可登记计划工时与实际工时
- **工时报表** - 按用户/项目汇总工时数据
- **成本核算** - 根据时薪自动计算项目成本

### 系统增强 (v1.2)
- **暗黑/亮色主题** - 一键切换主题，偏好保存至 localStorage
- **任务回收站** - 软删除机制，支持恢复与彻底删除
- **数据库备份** - 一键导出/导入 SQLite 数据库
- **飞书集成** - 绑定飞书账号，支持 OAuth 授权
- **个人设置** - 修改昵称、查看账户信息

### 智能搜索与筛选 (v1.3)
- **高级筛选** - 多条件组合筛选（状态/负责人/优先级/标签/日期范围）
- **筛选方案** - 保存/加载/删除常用筛选方案
- **全局搜索** - Cmd/Ctrl + K 快捷键，跨项目搜索任务
- **结果高亮** - 搜索结果关键词高亮显示
- **键盘导航** - 搜索结果支持上下键选择，回车跳转

### 看板与项目增强 (v1.3)
- **自定义看板列** - 管理员可添加/重命名/删除/排序看板列
- **列颜色配置** - 每个列可自定义颜色
- **项目模板** - 创建项目时可选模板（网站开发/产品迭代/客户支持）
- **模板管理** - 管理员可创建/编辑/删除自定义模板
- **从项目保存模板** - 将现有项目配置保存为模板
- **批量导入成员** - CSV/Excel 文件批量导入项目成员

### 权限与角色增强 (v1.3)
- **自定义角色** - 创建自定义角色，配置细粒度权限
- **权限矩阵** - 25+ 权限项，按分类分组配置
- **角色管理** - 管理员可创建/编辑/删除自定义角色
- **系统角色** - 5 个系统预设角色，保持向后兼容

### 甘特图增强 (v1.3)
- **拖拽创建依赖** - 从任务条拖拽到另一任务创建依赖关系
- **依赖类型编辑** - 双击依赖线编辑类型和延迟天数
- **颜色区分** - 四种依赖类型不同颜色（FS蓝/SS绿/FF橙/SF红）
- **依赖标签** - 依赖线显示类型标签和延迟天数

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
| 导出 | ExcelJS | 进度 Excel 导出 |

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

系统内置 6 个演示账号，**密码统一为 `123456`**：

| 角色 | 邮箱 | 说明 |
|------|------|------|
| 系统管理员 | `leigang@creat-value.com` | 全系统管理权限 |
| 财务人员 | `finance@creat-value.com` | 财务相关查看与统计 |
| 项目经理 | `wangju@creat-value.com` | 项目负责人 |
| 团队成员 | `huzhijun@creat-value.com` | 团队成员 |
| 团队成员 | `zhangzhe@creat-value.com` | 团队成员 |
| 外包人员 | `guest@pm.dev` | 只读访问 |

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
fortune-pm/
├── api/                          # 后端代码
│   ├── app.ts                    # Express 应用配置
│   ├── db.ts                     # 数据库连接 + 建表 + 种子数据
│   ├── lib/
│   │   ├── auth.ts               # JWT 认证中间件
│   │   ├── mail.ts               # 邮件发送（Nodemailer）
│   │   └── utils.ts              # 工具函数
│   ├── repository/
│   │   └── repo.ts               # 数据仓库层（含 historyRepo）
│   └── routes/
│       ├── auth.ts               # 认证路由
│       ├── projects.ts           # 项目路由
│       ├── tasks.ts              # 任务路由（含操作历史、回收站）
│       ├── stats.ts              # 统计路由
│       ├── team.ts               # 团队路由（含成员成本、类别）
│       ├── notifications.ts      # 通知路由
│       ├── templates.ts          # 任务模板路由
│       ├── projectTemplates.ts   # 项目模板路由（v1.3）
│       ├── roles.ts              # 自定义角色路由（v1.3）
│       ├── attachments.ts        # 附件路由
│       ├── budgets.ts            # 预算路由（含审批）
│       ├── expenses.ts           # 支出路由
│       ├── hours.ts              # 工时路由
│       ├── backup.ts             # 数据库备份路由
│       ├── feishu.ts             # 飞书集成路由
│       └── export.ts             # CSV/Excel 导出路由
│
├── src/                          # 前端代码
│   ├── App.tsx                   # 路由配置（含 React.lazy 代码分割）
│   ├── components/
│   │   ├── AppLayout.tsx         # 主布局（含主题切换、全局搜索）
│   │   ├── GlobalSearch.tsx      # 全局搜索组件（v1.3）
│   │   ├── BudgetPanel.tsx       # 预算面板
│   │   ├── GanttChart.tsx        # 甘特图视图
│   │   ├── KanbanBoard.tsx       # 看板视图
│   │   ├── KanbanColumnDialog.tsx # 看板列配置对话框（v1.3）
│   │   ├── DependencyDialog.tsx  # 依赖关系对话框（v1.3）
│   │   ├── MemberImportDialog.tsx # 成员导入对话框（v1.3）
│   │   ├── RoleDialog.tsx        # 角色编辑对话框（v1.3）
│   │   ├── TemplateDialog.tsx    # 模板编辑对话框（v1.3）
│   │   ├── TaskDrawer.tsx        # 任务详情抽屉
│   │   ├── TaskDialog.tsx        # 任务创建/编辑（含实时校验）
│   │   └── ...                   # 其他组件
│   ├── pages/
│   │   ├── Dashboard.tsx         # 仪表板
│   │   ├── Projects.tsx          # 项目列表
│   │   ├── ProjectDetail.tsx     # 项目详情（看板/列表/甘特图/预算）
│   │   ├── Stats.tsx             # 统计分析（懒加载）
│   │   ├── HoursReport.tsx       # 工时报表（懒加载）
│   │   ├── Templates.tsx         # 项目模板管理（v1.3）
│   │   ├── Roles.tsx             # 角色管理（v1.3）
│   │   ├── Trash.tsx             # 任务回收站
│   │   ├── Settings.tsx          # 个人设置（含备份/飞书）
│   │   └── ...                   # 其他页面
│   ├── stores/                   # Zustand 状态管理
│   ├── lib/
│   │   ├── api.ts                # API 客户端（含重试机制）
│   │   ├── constants.ts          # 共享状态常量
│   │   └── utils.ts              # 工具函数（含成员排序）
│   └── hooks/
│       └── useTheme.ts           # 主题切换 Hook
│
├── shared/
│   └── types.ts                  # 前后端共享类型（含预算/支出/工时）
├── data/                         # SQLite 数据库 + 附件
│   ├── app.db                    # 数据库文件
│   └── uploads/                  # 任务附件存储
├── docs/                         # 文档
│   ├── 操作手册.md
│   └── 概要设计书.md
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
- ✅ **v1.1** - 批量操作、@提及、任务模板、任务附件、邮件通知、CSV 导出、甘特图、进度拖拽、操作历史、代码分割
- ✅ **v1.2** - 暗黑/亮色主题、任务回收站、数据库备份/恢复、预算管理（含审批）、支出登记、工时管理、飞书集成、成员成本、个人设置
- ✅ **v1.3** - 高级筛选、全局搜索、自定义看板列、项目模板、自定义角色、甘特图拖拽依赖、成员批量导入
- 🔜 **v1.4+** - 富文本评论、实时协作、移动端适配、自定义工作流

---

## 📝 License

MIT © Atlas Project

*让每一次推进，都被看见*
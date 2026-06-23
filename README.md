# Wafer TinyCNN 晶圆缺陷检测平台 (Wafer Platform)

这是一个面向半导体晶圆（Wafer）图谱缺陷检测的智能分析与标注审核平台。平台深度整合了基于 **TinyCNN** 的轻量化深度学习网络，提供了从数据集管理、人工审核、模型训练到推理包导出的全流程晶圆检测方案。

---

## 🌟 功能特性

- 📂 **数据集注册与上传**：支持扫描本地文件夹或上传 `.zip` 压缩包，自动提取并分类晶圆图谱。
- 🔍 **智能标注与审核**：内置了标注队列、高风险样本分流机制，支持键盘快捷键极速标注。
- 📈 **模型训练配置与监控**：支持数十项核心与专家训练参数的可视化微调，训练指标（Loss / 召回 / 误检）实时曲线展示。
- 📊 **多维模型评估**：提供详尽的召回率统计和混淆矩阵分析，直观展示 FN（漏检）与 FP（误检）分布。
- ⚙️ **模型仓库管理**：支持一键将特定模型标记为生产模型（Production），支持模型重命名、安全删除及状态追踪。
- 🚀 **一键推理与导出**：一键生成 PT + ONNX 生产部署包，附带自动计算的阈值配置文件。

---

## 🛠️ 技术栈

### 前端 UI (Vite + React)
- **核心框架**：React 18 + TypeScript + Vite
- **图表数据**：Recharts (折线图 / 混淆矩阵热力)
- **视觉图标**：Lucide React
- **样式方案**：Tailwind CSS (Vanilla CSS + 响应式布局)

### 后端服务 (Python HTTP Server)
- **Web 服务**：Python 自带的多线程安全 `ThreadingHTTPServer` (无需安装 Flask/FastAPI 外部大包)
- **存储方案**：本地轻量 SQLite 数据库，用于存储数据集、样本标签、训练运行和推理任务状态。
- **环境要求**：Python 3.8+ 及其标准库。

---

## 🚀 快速启动指南

### 1. 克隆与安装依赖

进入项目根目录安装前端 Node 依赖包：
```bash
npm install
```

### 2. 启动平台服务

平台运行采用前后端分离，配合 Vite 代理转发。

#### 步骤一：启动 Python 后端服务
```bash
npm run serve
```
或者手动运行：
```bash
python run_platform.py
```
后端服务默认监听在 `http://127.0.0.1:8765` 端口，并在首次启动时自动建立 SQLite 数据库 `storage/platform.db`。

#### 步骤二：启动 Vite 开发服务器
在另一个终端运行：
```bash
npm run dev
```
开发服务器将运行在 `http://localhost:5173/`。打开浏览器访问该地址即可。

---

## 📂 项目结构

```text
wafer_platform/
├── backend/                  # Python 后端源代码
│   ├── platform_server.py    # 数据库连接、路由控制与 API 处理中心
│   └── __init__.py
├── src/                      # 前端 React 源代码
│   ├── App.tsx               # 应用主框架及页面路由切换
│   ├── api.ts                # API 异步请求层
│   ├── types.ts              # 数据模型及 TypeScript 类型定义
│   ├── data/                 # 静态与 Mock 数据集
│   ├── utils/                # 状态处理与纯函数计算
│   └── main.tsx              # React 入口
├── storage/                  # 本地持久化目录 (已添加在 .gitignore 中)
│   ├── platform.db           # SQLite 数据库文件
│   └── datasets/             # 用户扫描及上传的数据集存储
├── .ai_docs/                 # 开发设计与改动日志说明
├── package.json              # 脚本配置与依赖列表
└── vite.config.ts            # Vite 构建及 /api 代理转发配置
```

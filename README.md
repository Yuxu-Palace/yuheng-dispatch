# 版本管理 GitHub Action

[![GitHub Release](https://img.shields.io/github/release/Yuxu-Palace/yuheng-dispatch.svg)](https://github.com/Yuxu-Palace/yuheng-dispatch/releases)
[![GitHub License](https://img.shields.io/github/license/Yuxu-Palace/yuheng-dispatch.svg)](https://github.com/Yuxu-Palace/yuheng-dispatch/blob/main/LICENSE)

一个专门为语义化版本管理设计的 GitHub Action。支持 Beta/Main 两级分支管理策略，提供智能版本推导和 CHANGELOG 生成功能。

## 🌟 核心特性

- **🔄 两级分支管理**：支持 beta → main 分支策略
- **🏷️ 智能版本推导**：基于 PR 标签和分支关系自动计算版本
- **📝 CHANGELOG 生成**：基于 PR 信息自动生成变更日志
- **🔗 分支同步**：自动同步版本到下游分支，智能冲突解决
- **💬 PR 评论**：实时预览版本变更，提供详细的版本信息
- **📦 预览包（可选）**：可通过独立工作流集成 pkg.pr.new 预览包发布

## 📋 版本管理规则

### Beta 分支 (`beta`)
- **触发条件**：PR 必须包含标签 (`major`, `minor`, `patch`)，无标签则跳过
- **源分支**：接受来自任意功能分支（`feature/*`, `bugfix/*`, `hotfix/*` 等）的合并
- **版本计算规则**：
  1. 基于标签类型推导目标基础版本号（从 main 分支版本 + 标签）
  2. 比较推导版本与当前 beta 版本：
     - **高于当前版本**：修改基础号，重置测试号（`x.y.z-beta.0`）
     - **低于等于当前版本**：只增加测试号计数（`x.y.z-beta.n++`）

```
示例：
Main: v1.0.0, Beta: v1.1.0-beta.2
PR 标签: minor → 目标: v1.1.0 ≤ v1.1.0 → 结果: v1.1.0-beta.3

Main: v1.0.0, Beta: v1.1.0-beta.2
PR 标签: major → 目标: v2.0.0 > v1.1.0 → 结果: v2.0.0-beta.0
```

### Main 分支 (`main`)
- **源分支限制**：接受来自 Beta 分支（正常发布）或 Hotfix 分支（紧急修复）
- **版本规则**：
  - **来自 Beta**：去除预发布标识，发布正式版本（`x.y.z-beta.n` → `x.y.z`）
  - **来自 Hotfix**：
    - 分支命名必须以 `hotfix/` 开头（如 `hotfix/critical-bug`）
    - 必需标签：`hotfix` + 版本标签（`major`/`minor`/`patch`）
    - 版本计算：当前版本 + 标签类型（如 `v1.2.0` + `patch` → `v1.2.1`）

### 分支同步策略
- **Main → Beta**：使用 `rebase` 同步
- **智能冲突处理**：自动创建 Issue 记录无法解决的冲突

## 🚀 快速开始

### 1. 基本配置

在您的项目中创建 `.github/workflows/version-management.yml`：

```yaml
name: 版本管理

on:
  pull_request:
    branches: [main, beta]
    types: [opened, synchronize, reopened, labeled, unlabeled, closed]

jobs:
  version-management:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: 版本管理
        uses: Yuxu-Palace/yuheng-dispatch@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

          # 版本管理配置
          version-prefix: 'v'
          enable-changelog: 'true'
```

### 2. PR 标签配置

在您的仓库中创建以下标签：

**版本标签**（必需）：
- `major`：主版本更新（破坏性变更）
- `minor`：次版本更新（新增功能）
- `patch`：补丁版本更新（bug 修复）

**特殊标签**（可选）：
- `hotfix`：紧急修复标识（用于 hotfix 分支合并到 main，必须与版本标签组合使用）

## 📖 使用示例

### Beta 分支开发流程

```bash
# 1. 创建功能分支
git checkout -b feature/new-api beta
# ... 开发新功能

# 2. 创建 PR 到 beta 分支，添加 minor 标签
# Action 将自动：
# - 计算新版本：v1.2.0-beta.0
# - 更新 package.json 和 CHANGELOG
# - 创建版本标签

# 3. 继续迭代
# 后续 PR 如果标签相同，将递增测试号：v1.2.0-beta.1
```

### Main 分支发布流程

```bash
# Beta 测试完成，创建 PR：beta → main
# Action 将自动：
# - 发布正式版本：v1.2.0
# - 同步代码到 beta 分支
```

### Hotfix 紧急修复流程

```bash
# 1. 从 main 创建 hotfix 分支（必须以 hotfix/ 开头）
git checkout -b hotfix/critical-security-fix main
# ... 修复 bug

# 2. 创建 PR 到 main 分支，添加两个必需标签：
# - hotfix（标识紧急修复）
# - patch（版本升级类型，通常 bug 修复用 patch）

# Action 将自动：
# - 升级版本：v1.2.0 → v1.2.1
# - 更新 CHANGELOG
# - 同步代码到 beta 分支
```

## 🧪 集成 pkg.pr.new 预览包（可选）

如需为 PR 提供可安装的预览包，可在工作流中添加独立的 `pkg-preview` 任务：

### 完整配置示例

```yaml
name: 版本管理

on:
  pull_request:
    branches: [main, beta]
    types: [opened, synchronize, reopened, labeled, unlabeled, closed]

jobs:
  version-management:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: 版本管理
        uses: Yuxu-Palace/yuheng-dispatch@main
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

  # 可选：添加预览包发布任务
  pkg-preview:
    if: github.event.pull_request.merged == false && github.event.action != 'closed'
    needs: version-management
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: 发布预览包
        run: pnpm dlx pkg-pr-new publish
```

### 特性说明

- **职责分离**：版本管理和包发布独立运行，互不影响
- **按需触发**：仅在 PR 未合并时运行，避免资源浪费
- **灵活控制**：可自定义触发条件（如仅在 review approved 后）
- **官方最佳实践**：符合 pkg.pr.new 推荐的使用方式

详细配置参见项目的 [.github/workflows/version-patch.yml](.github/workflows/version-patch.yml) 文件。

## 💬 PR 评论输出

Action 会在 PR 中自动创建评论，显示版本管理信息：

### 版本预览评论
当 PR 有版本标签时，会显示版本预览：

```markdown
## 📦 版本管理

| 项目 | 值 |
|------|-----|
| **源分支** | `feature/new-api` |
| **目标分支** | `beta` |
| **当前版本** | `v1.0.0-beta.1` |
| **下一版本** | `v1.1.0-beta.0` |

> ℹ️ 这是预览模式，合并 PR 后将自动创建 tag 并更新版本。
```

### 跳过处理评论
当 PR 无需版本升级时：

```markdown
## 📦 版本管理

| 项目 | 值 |
|------|-----|
| **目标分支** | `beta` |
| **当前版本** | `v1.0.0-beta.1` |
| **状态** | `跳过 - 无需升级` |

> ℹ️ 根据当前分支状态和标签，无需进行版本升级。
```

### 错误评论
当遇到错误时：

```markdown
## 📦 版本管理

❌ **错误信息**

Beta 分支需要 PR 标签（major/minor/patch）来确定版本升级类型。

> 请在 PR 上添加合适的版本标签。
```

## ⚙️ 配置参数

### 基础配置

| 参数 | 描述 | 必需 | 默认值 |
|------|------|------|--------|
| `token` | GitHub token | ✅ | - |
| `version-prefix` | 版本标签前缀 | ❌ | `v` |
| `git-user-name` | Git 提交用户名 | ❌ | `GitHub Action` |
| `git-user-email` | Git 提交邮箱 | ❌ | `action@github.com` |
| `enable-changelog` | 启用 CHANGELOG 生成 | ❌ | `true` |
| `comment-title` | PR 评论标题 | ❌ | `📦 版本管理` |

### 输出参数

| 输出 | 描述 |
|------|------|
| `next-version` | 计算出的新版本号 |
| `preview-version` | 预览版本号 |
| `is-preview` | 是否为预览模式 |

## 🔧 高级配置

### 自定义版本前缀

```yaml
version-prefix: 'rel-'  # 生成标签：rel-1.0.0
```


## 📚 工作流程图

```mermaid
graph TD
    A[Feature Branch] --> B[PR to Beta + Label]
    B --> C{有标签?}
    C -->|否| D[跳过处理]
    C -->|是| E[计算 Beta 版本]
    E --> F[x.y.z-beta.n]

    F --> G[PR to Main]
    G --> H[x.y.z]

    H --> I[Main → Beta]
    I --> J[版本同步完成]
```

## 🤝 分支策略最佳实践

### 开发流程建议

1. **功能开发**：从 beta 分支创建功能分支，开发完成后合并回 beta
2. **生产发布**：beta 测试完成后合并到 main 发布生产版本
3. **紧急修复**：从 main 创建 `hotfix/*` 分支，修复后直接合并到 main

### 标签使用建议

**版本标签**（用于版本升级）：
- `major`：API 破坏性变更、架构重构
- `minor`：新增功能、新增 API
- `patch`：bug 修复、性能优化、文档更新

**特殊标签**：
- `hotfix`：紧急修复标识（仅用于 hotfix 分支合并到 main，必须与版本标签一起使用）

## 📝 故障排除

### 常见问题

1. **版本计算错误**
   - 检查分支标签是否正确
   - 确认 PR 来源和目标分支符合规则

2. **分支同步冲突**
   - Action 会自动创建 Issue 记录冲突
   - 手动解决冲突后重新运行


## 🏗️ 本地开发

### 环境要求

- Node.js 20+
- pnpm 10+

### 安装依赖

```bash
pnpm install
```

### 构建

```bash
pnpm build
```

### 在您的项目中配置 npm 发布（可选）

如果您的项目需要发布到 npm，可以配置以下脚本到您项目的 `package.json`：

```json
{
  "scripts": {
    "prepublishOnly": "pnpm build",
    "release:main": "pnpm publish --access public",
    "release:beta": "pnpm publish --access public --tag beta"
  }
}
```

**发布流程：**

1. **确保版本已更新**：本 Action 会自动更新 `package.json` 版本号
2. **配置 npm 凭据**：在项目 `.npmrc` 中设置 `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`
3. **手动发布**：
   - Beta 版本：`pnpm run release:beta`（发布为 `@beta` tag）
   - 正式版本：`pnpm run release:main`（发布为 `latest` tag）
4. **或使用 CI/CD**：在 GitHub Actions workflow 中自动发布

**CI/CD 自动发布示例：**

```yaml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install

      - name: Publish to npm
        run: |
          if [[ ${{ github.ref }} == *"beta"* ]]; then
            pnpm run release:beta
          else
            pnpm run release:main
          fi
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

> 💡 **提示**：本 Action 会自动管理版本号和 CHANGELOG，您只需要在版本更新后执行发布即可。

### 代码格式化

```bash
pnpm check
pnpm format
```

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请确保：

1. 遵循现有代码风格
2. 添加适当的测试
3. 更新相关文档

---

如有问题，请在 [Issues](https://github.com/Yuxu-Palace/yuheng-dispatch/issues) 中反馈。

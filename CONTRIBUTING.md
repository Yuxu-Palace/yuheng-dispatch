# 贡献指南

感谢您对 yuheng-dispatch 项目的关注！我们欢迎任何形式的贡献。

## 📋 目录

- [行为准则](#行为准则)
- [开始之前](#开始之前)
- [开发环境搭建](#开发环境搭建)
- [项目结构](#项目结构)
- [开发流程](#开发流程)
- [代码规范](#代码规范)
- [提交规范](#提交规范)
- [测试要求](#测试要求)
- [Pull Request 流程](#pull-request-流程)

---

## 行为准则

本项目遵循 [Contributor Covenant](https://www.contributor-covenant.org/) 行为准则。参与本项目即表示您同意遵守其条款。

---

## 开始之前

在开始贡献之前，请：

1. **搜索现有 Issues**：确认您的想法或发现的问题是否已被提出
2. **创建 Issue 讨论**：对于重大变更，请先创建 Issue 讨论方案
3. **阅读文档**：熟悉项目的 [README](README.md) 和 [架构文档](docs/data-flow.md)

---

## 开发环境搭建

### 前置要求

- **Node.js**: >= 20.x
- **pnpm**: >= 10.x
- **Git**: >= 2.x

### 克隆和安装

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/YOUR_USERNAME/yuheng-dispatch.git
cd yuheng-dispatch

# 2. 安装依赖
pnpm install

# 3. 构建项目
pnpm build

# 4. 运行测试
pnpm test

# 5. 运行代码检查
pnpm check
```

### 开发命令

```bash
# 构建
pnpm build              # 构建 Action (输出到 dist/index.cjs)

# 代码质量
pnpm check              # 运行 Biome 检查和自动修复
pnpm format             # 仅运行格式化

# 测试
pnpm test               # 运行所有测试
pnpm test:watch         # 监听模式运行测试
pnpm test:coverage      # 生成测试覆盖率报告
pnpm test:ui            # 打开测试 UI 界面
```

---

## 项目结构

```
yuheng-dispatch/
├── src/
│   ├── test/              # 测试文件
│   ├── core/              # 核心业务逻辑
│   │   ├── version/       # 版本管理
│   │   ├── git/           # Git 操作
│   │   └── changelog/     # CHANGELOG 生成
│   ├── github/            # GitHub 集成
│   │   ├── pr/            # PR 操作
│   │   └── actions.ts     # GitHub Actions 包装
│   ├── utils/             # 工具函数和配置
│   │   ├── index.ts       # 通用工具
│   │   ├── constants.ts   # 配置常量
│   │   └── types.ts       # 类型定义
│   └── index.ts           # 主入口
├── dist/                  # 构建产物 (Git 提交)
├── docs/                  # 文档
├── .github/               # GitHub 配置
│   └── workflows/         # CI/CD 工作流
├── action.yaml            # GitHub Action 定义
├── package.json
├── tsconfig.json
├── tsup.config.ts         # 构建配置
├── vitest.config.ts       # 测试配置
└── biome.json             # 代码质量配置
```

### 核心模块说明

- **core/version** (728行) - 版本计算核心，包含 Beta/Main 升级策略
- **core/git** (225行) - Git 操作封装，分支同步逻辑
- **core/changelog** (279行) - CHANGELOG 智能生成
- **github/pr** (119行) - GitHub PR 评论管理
- **utils** (260行) - 版本解析、Git 命令、错误处理

---

## 开发流程

### 1. 创建分支

```bash
# 功能开发
git checkout -b feature/your-feature-name

# Bug 修复
git checkout -b fix/bug-description

# 文档更新
git checkout -b docs/what-you-updated

# 代码重构
git checkout -b refactor/what-you-refactored
```

### 2. 开发和测试

```bash
# 编写代码
# ...

# 运行测试（重要！）
pnpm test

# 运行代码检查
pnpm check

# 构建验证
pnpm build
```

### 3. 提交代码

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```bash
# 格式: <type>(<scope>): <description>

git commit -m "feat(version): 添加对 alpha 预发布版本的支持"
git commit -m "fix(git): 修复分支同步时的冲突处理"
git commit -m "docs: 更新 CONTRIBUTING.md"
git commit -m "test(utils): 添加版本解析边界情况测试"
```

**Commit 类型**:
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建/工具配置

### 4. 推送和创建 PR

```bash
git push origin your-branch-name
```

然后在 GitHub 上创建 Pull Request。

---

## 代码规范

### TypeScript 规范

- ✅ 启用 **strict 模式**
- ✅ 所有函数必须有明确的**类型签名**
- ✅ 避免使用 `any`，使用 `unknown` 或具体类型
- ✅ 使用类型守卫确保类型安全

### 命名约定

```typescript
// 变量和函数 - camelCase
const versionNumber = '1.0.0';
function calculateNewVersion() { }

// 类和接口 - PascalCase
class VersionManager { }
interface VersionSummary { }

// 常量 - UPPER_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 3;
const GIT_USER_CONFIG = { };

// 文件名 - kebab-case 或 index.ts
version-calculator.ts
index.ts
```

### 代码风格

项目使用 **Biome** 进行代码格式化和检查（配置见 `biome.json`）：

- **行宽**: 120 字符
- **缩进**: 2 空格
- **引号**: 单引号
- **函数最大行数**: 100 行
- **圈复杂度**: ≤ 15

**重要**: Git hooks 会自动运行 `pnpm check`，提交前会自动格式化代码。

### 注释规范

使用 JSDoc 为导出的函数添加文档：

```typescript
/**
 * 从 PR 标签获取发布类型
 *
 * 根据 PR 的标签（major/minor/patch）确定语义化版本的发布类型。
 * 对于 Beta 分支，会自动转换为对应的 pre* 类型。
 *
 * @param labels - PR 的标签列表
 * @returns 发布类型（premajor/preminor/prepatch），无匹配返回 null
 *
 * @example
 * ```typescript
 * getReleaseTypeFromLabels([{ name: 'minor' }]); // 'preminor'
 * getReleaseTypeFromLabels([{ name: 'docs' }]);  // null
 * ```
 */
export function getReleaseTypeFromLabels(
  labels: { name: string }[]
): ReleaseType | null {
  // 实现...
}
```

---

## 提交规范

### Commit Message 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

**示例**:

```
feat(version): 添加对自定义版本前缀的支持

- 允许用户配置自定义版本前缀
- 更新版本解析逻辑支持多种前缀格式
- 添加相关单元测试

Closes #123
```

### Pre-commit Hooks

项目配置了 Husky pre-commit hooks，会自动：

1. **格式化代码**: 运行 `pnpm format` 和 `pnpm check`
2. **构建 Action**: 运行 `pnpm build` 并自动添加 `dist/` 到提交

**注意**: 不要手动修改 `dist/` 目录，它会自动生成。

---

## 测试要求

### 编写测试

所有新功能和 Bug 修复都**必须**包含测试！

**测试文件位置**: `src/test/`

```bash
src/test/
├── utils.test.ts      # utils 模块测试
├── version.test.ts    # version 模块测试
└── ...                # 其他模块测试
```

### 测试示例

```typescript
import { describe, expect, it } from 'vitest';
import { yourFunction } from '../your-module';

describe('yourFunction()', () => {
  it('应该正确处理正常情况', () => {
    expect(yourFunction('input')).toBe('expected');
  });

  it('应该处理边界情况', () => {
    expect(yourFunction('')).toBe('default');
  });

  it('应该处理错误输入', () => {
    expect(() => yourFunction(null)).toThrow();
  });
});
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 监听模式（开发时推荐）
pnpm test:watch

# 生成覆盖率报告
pnpm test:coverage
```

### 覆盖率要求

- **新功能**: 测试覆盖率 ≥ 80%
- **Bug 修复**: 必须包含回归测试
- **核心模块** (version, utils): 覆盖率 ≥ 85%

---

## Pull Request 流程

### 1. 创建 PR 前的检查清单

- [ ] 代码通过所有测试 (`pnpm test`)
- [ ] 代码通过 Biome 检查 (`pnpm check`)
- [ ] 代码已构建成功 (`pnpm build`)
- [ ] 添加了必要的测试
- [ ] 更新了相关文档（如果需要）
- [ ] Commit 信息符合规范

### 2. PR 标题和描述

**标题格式**: `<type>: <description>`

**描述应包含**:
- **变更类型**: feat/fix/docs/refactor/test/chore
- **变更说明**: 详细描述你的变更
- **相关 Issue**: 关联的 Issue 编号（如 `Closes #123`）
- **测试**: 说明如何测试你的变更
- **截图/日志**: 如果适用

### 3. PR 审查

维护者会审查：
- ✅ 代码质量和规范性
- ✅ 测试覆盖率
- ✅ 功能正确性
- ✅ 文档完整性
- ✅ 性能影响

### 4. 合并要求

PR 必须满足：
- ✅ 所有 CI 检查通过
- ✅ 至少一位维护者批准
- ✅ 无未解决的讨论
- ✅ 代码冲突已解决

---

## 报告 Bug

发现 Bug？请创建 Issue 并提供：

1. **版本信息**: 使用的 Action 版本
2. **复现步骤**: 详细的复现步骤
3. **期望行为**: 预期应该发生什么
4. **实际行为**: 实际发生了什么
5. **相关日志**: GitHub Actions 运行日志
6. **环境信息**: 仓库信息、分支策略等

---

## 功能请求

有新想法？欢迎创建 Feature Request！

请说明：
1. **功能描述**: 你希望添加什么功能
2. **使用场景**: 为什么需要这个功能
3. **期望行为**: 功能应该如何工作
4. **替代方案**: 是否考虑过其他实现方式

---

## 开发技巧

### 本地测试 GitHub Action

由于这是 GitHub Action，本地测试比较困难。推荐方法：

**方法 1: 使用 act**
```bash
# 安装 act (https://github.com/nektos/act)
brew install act

# 模拟 PR 事件
act pull_request -e .github/workflows/test-event.json
```

**方法 2: 在测试仓库中测试**
1. Fork 本项目
2. 创建测试 PR
3. 观察 Action 运行结果

### 调试技巧

```typescript
// 使用 logger 记录调试信息
import { logger } from '../github/actions';

logger.info(`调试信息: ${JSON.stringify(data)}`);
logger.warning('警告信息');
logger.error('错误信息');
```

### 常见问题

**Q: 为什么 dist/ 目录总是有变更？**

A: pre-commit hook 会自动构建并添加 `dist/`。这是必要的，因为 GitHub Actions 需要构建产物。

**Q: 如何跳过 pre-commit hook？**

A: 不建议跳过，但如果必要：
```bash
git commit --no-verify -m "your message"
```

**Q: 测试失败怎么办？**

A:
1. 检查是否安装了所有依赖
2. 清理并重新安装: `rm -rf node_modules && pnpm install`
3. 检查 Node.js 版本是否 >= 20

---

## 发布流程

发布流程由维护者负责：

1. Beta 测试版本通过后，创建 PR 从 `beta` 到 `main`
2. 合并 PR 后自动创建正式版本
3. 手动执行 `pnpm release` 发布到 npm（如果需要）

---

## 获取帮助

- **文档**: [README](README.md) | [架构文档](docs/data-flow.md)
- **Issues**: [GitHub Issues](https://github.com/Yuxu-Palace/yuheng-dispatch/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Yuxu-Palace/yuheng-dispatch/discussions)

---

## 许可证

通过贡献代码，您同意您的贡献将使用与本项目相同的 [MIT License](LICENSE) 进行许可。

---

**再次感谢您的贡献！** 🎉

如有任何疑问，欢迎在 Issue 中提问或在 Discussion 中讨论。

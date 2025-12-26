import { getInput, logger } from '@/github/actions';
import type { VersionPreviewData } from '@/utils/types';

// ==================== 配置常量 ====================

export const SUPPORTED_BRANCHES = ['main', 'beta'];

/** 支持的前缀列表（按长度从长到短排序，避免短前缀误匹配） */
const SUPPORTED_PREFIXES = ['version-', 'ver-', 'rel-', 'v'] as const;

/** 支持的前缀类型 */
type SupportedPrefix = (typeof SUPPORTED_PREFIXES)[number];

/** 类型守卫：检查是否为支持的前缀 */
function isSupportedPrefix(prefix: string): prefix is SupportedPrefix {
  return SUPPORTED_PREFIXES.includes(prefix as SupportedPrefix);
}

/** 版本前缀配置 */
export const VERSION_PREFIX_CONFIG = {
  /** 当前使用的前缀（自动处理用户输入和默认值） */
  CURRENT: (() => {
    const customPrefix = getInput('version-prefix');
    if (!customPrefix) {
      return 'v';
    }

    if (isSupportedPrefix(customPrefix)) {
      return customPrefix;
    }

    logger.warning(`不支持的版本前缀 "${customPrefix}"，使用默认值 "v"`);
    return 'v';
  })(),
  /** 支持的前缀列表（用于兼容性处理） */
  SUPPORTED: SUPPORTED_PREFIXES,
} as const;

/** Git 用户配置 */
export const GIT_USER_CONFIG = {
  NAME: getInput('git-user-name') || 'GitHub Action',
  EMAIL: getInput('git-user-email') || 'action@github.com',
} as const;

/** 评论配置 */
export const COMMENT_CONFIG = {
  /** 评论标题（可通过 action 输入覆盖） */
  TITLE: getInput('comment-title') || '📦 版本管理',
} as const;

/** 默认版本号 */
export const DEFAULT_VERSIONS = {
  BASE: '0.0.0',
  BETA: '0.0.0-beta.0',
} as const;

// ==================== CHANGELOG 相关常量 ====================

/** PR 标签到 CHANGELOG 类型的映射 */
export const LABEL_TO_CHANGELOG_TYPE: Record<string, string> = {
  MAJOR: '💥 Breaking Changes',
  MINOR: '✨ Features',
  PATCH: '🐛 Bug Fixes',
  ENHANCEMENT: '⚡ Improvements',
  PERFORMANCE: '🚀 Performance',
  SECURITY: '🔒 Security',
  DOCUMENTATION: '📚 Documentation',
  DEPENDENCIES: '⬆️ Dependencies',
  OTHER: '📝 Changes',
};

// ==================== 消息模板 ====================

/** 评论模板 */
export const COMMENT_TEMPLATES = {
  /** 版本管理评论模板 */
  VERSION_PREVIEW: (data: VersionPreviewData) => `## ${COMMENT_CONFIG.TITLE}

| 项目 | 值 |
|------|-----|
| **源分支** | \`${data.sourceBranch}\` |
| **目标分支** | \`${data.targetBranch}\` |
| **当前版本** | \`${data.currentVersion || '无'}\` |
| **下一版本** | \`${data.nextVersion}\` |

> ℹ️ 这是预览模式，合并 PR 后将自动创建 tag 并更新版本。`,

  /** 错误评论模板 */
  ERROR: (errorMessage: string) => `## ${COMMENT_CONFIG.TITLE}

❌ **错误信息**

${errorMessage}

> 请确保在创建新功能之前，所有已有功能都已完成完整的发布流程（beta → main）。`,

  /** 版本跳过模板 */
  VERSION_SKIP: (targetBranch: string, baseVersion: string | null) => `## ${COMMENT_CONFIG.TITLE}

| 项目 | 值 |
|------|-----|
| **目标分支** | \`${targetBranch}\` |
| **当前版本** | \`${baseVersion || '无'}\` |
| **状态** | \`跳过 - 无需升级\` |

> ℹ️ 根据当前分支状态和标签，无需进行版本升级。`,
} as const;

/** 错误消息 */
export const ERROR_MESSAGES = {
  UNSUPPORTED_BRANCH: (branch: string) => `不支持的分支: ${branch}，跳过版本管理`,
  UNSUPPORTED_EVENT: (eventName: string) => `不支持的事件类型: ${eventName}`,
  INVALID_VERSION: (version: string) => `无效的版本号: ${version}`,
  MERGE_CONFLICT: (sourceBranch: string, targetBranch: string) =>
    `无法自动解决 ${sourceBranch} -> ${targetBranch} 的合并冲突，已创建 issue 需要人工介入`,
} as const;

// ==================== CHANGELOG 相关常量 ====================

/** PR Section 匹配模式 */
export const PR_SECTION_PATTERNS = [
  '### Changes',
  '## Changes',
  "### What's Changed",
  "## What's Changed",
  '### Summary',
  '## Summary',
] as const;

/** 提交消息模板 */
export const COMMIT_TEMPLATES = {
  VERSION_BUMP: (version: string, branch: string) => `chore: bump version to ${version} for ${branch}`,
  SYNC_MAIN_TO_BETA: (version: string) => `chore: sync main ${version} to beta [skip ci]`,
  FORCE_SYNC: (version: string) => `chore: force sync from main ${version} [skip ci]`,
  CHANGELOG_UPDATE: (version: string) => `docs: update CHANGELOG for ${version}`,
} as const;

// ==================== 操作配置常量 ====================

/** Git 重试配置 */
export const RETRY_CONFIG = {
  /** 最大重试次数 */
  MAX_ATTEMPTS: 3,
  /** 最小延迟时间(毫秒) */
  DELAY_MIN_MS: 1000,
  /** 最大延迟时间(毫秒) */
  DELAY_MAX_MS: 3000,
} as const;

/** CHANGELOG 配置 */
export const CHANGELOG_CONFIG = {
  /** 每个section最多显示的行数 */
  MAX_LINES_PER_SECTION: 5,
  /** 预览显示的行数 */
  PREVIEW_LINES: 15,
} as const;

/** 分页配置 */
export const PAGINATION_CONFIG = {
  /** 每页评论数量 */
  COMMENTS_PER_PAGE: 100,
} as const;

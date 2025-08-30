import * as fs from 'node:fs';
import { exec } from '@actions/exec';
import { VERSION_PREFIX_CONFIG } from './constants';
import { logger } from './core';
import { ActionError, type SupportedBranch } from './types';

// ==================== 版本处理工具函数 ====================

/**
 * 获取版本前缀
 */
export function getVersionPrefix(): string {
  return VERSION_PREFIX_CONFIG.custom;
}

/**
 * 移除版本号前缀，支持多种前缀格式
 */
export function cleanVersion(version: string): string {
  const currentPrefix = getVersionPrefix();

  // 优先检查当前使用的前缀
  if (version.startsWith(currentPrefix)) {
    return version.slice(currentPrefix.length);
  }

  // 兼容处理：检查其他支持的前缀
  for (let i = 0; i < VERSION_PREFIX_CONFIG.supported.length; i++) {
    const supportedPrefix = VERSION_PREFIX_CONFIG.supported[i];
    // 跳过已经检查过的当前前缀
    if (supportedPrefix === currentPrefix) {
      continue;
    }

    if (version.startsWith(supportedPrefix)) {
      return version.slice(supportedPrefix.length);
    }
  }

  // 如果没有找到任何前缀，直接返回原版本号
  return version;
}

/**
 * 添加版本前缀
 */
export function addVersionPrefix(version: string): string {
  const prefix = getVersionPrefix();
  const cleanVer = cleanVersion(version);
  return `${prefix}${cleanVer}`;
}

/**
 * 标准化版本号（确保使用正确的前缀）
 */
export function normalizeVersion(version: string): string {
  return addVersionPrefix(cleanVersion(version));
}

// ==================== Git 工具函数 ====================

/**
 * Git 错误处理函数
 */
function handleGitError(error: unknown, context: string, shouldThrow = false): void {
  const message = `${context}: ${error}`;
  logger.error(message);
  if (shouldThrow) {
    throw new ActionError(message, context, error);
  }
}

/**
 * 执行 git 命令并返回输出
 */
export async function execGitWithOutput(args: string[]): Promise<string> {
  let stdout = '';
  try {
    await exec('git', args, {
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString();
        },
      },
    });
    return stdout.trim();
  } catch (error) {
    handleGitError(error, `执行 git ${args.join(' ')}`, true);
    return '';
  }
}

/**
 * 执行 git 命令（无输出捕获）
 */
export async function execGit(args: string[]): Promise<void> {
  try {
    await exec('git', args);
  } catch (error) {
    handleGitError(error, `执行 git ${args.join(' ')}`, true);
  }
}

/**
 * 检查文件是否有未提交的更改
 */
export async function hasFileChanges(filepath: string): Promise<boolean> {
  try {
    // 检查文件是否存在 - 使用 Node.js fs 模块更可靠
    if (!fs.existsSync(filepath)) {
      return false;
    }

    // 检查是否有变化
    const statusOutput = await execGitWithOutput(['status', '--porcelain', filepath]);
    if (statusOutput.length > 0) {
      logger.info(`检测到 ${filepath} 变化: ${statusOutput}`);
      return true;
    }

    // 检查已跟踪文件的变化
    try {
      await exec('git', ['diff', '--exit-code', filepath]);
      return false;
    } catch {
      return true;
    }
  } catch (error) {
    handleGitError(error, `检查 ${filepath} 变化状态`, false);
    return false;
  }
}

/**
 * 提交并推送单个文件
 */
export async function commitAndPushFile(
  filepath: string,
  commitMessage: string,
  targetBranch: SupportedBranch,
): Promise<void> {
  try {
    await execGit(['add', filepath]);
    await execGit(['commit', '-m', commitMessage]);
    await execGit(['push', 'origin', targetBranch]);
    logger.info(`${filepath} 更新已提交并推送`);
  } catch (error) {
    handleGitError(error, `提交和推送 ${filepath}`, true);
  }
}

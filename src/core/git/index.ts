import { context } from '@actions/github';
import { hasChangelogChanges, updateChangelog } from '@/core/changelog';
import { updatePackageVersion } from '@/core/version';
import { logger } from '@/github/actions';
import { ActionError, execGit, versionParse } from '@/utils';
import { COMMIT_TEMPLATES, GIT_USER_CONFIG, RETRY_CONFIG, VERSION_PREFIX_CONFIG } from '@/utils/constants';
import type { BranchSyncResult, PRData, SupportedBranch } from '@/utils/types';

// ==================== Git 基础操作 ====================

/**
 * 配置 Git 用户信息
 */
export async function configureGitUser(): Promise<void> {
  logger.info('配置 Git 用户信息');
  await execGit(['config', '--global', 'user.name', GIT_USER_CONFIG.NAME]);
  await execGit(['config', '--global', 'user.email', GIT_USER_CONFIG.EMAIL]);
}

/**
 * 提交并推送版本更改
 */
export async function commitAndPushVersion(version: string, targetBranch: SupportedBranch): Promise<void> {
  try {
    const { targetVersion: fullVersion } = versionParse(version);

    // 提交版本更改
    await execGit(['add', '.']);
    await execGit(['commit', '-m', COMMIT_TEMPLATES.VERSION_BUMP(fullVersion, targetBranch)]);

    // 创建版本标签
    await execGit(['tag', fullVersion]);
    logger.info(`已创建标签: ${fullVersion}`);

    // 推送更改和标签（添加冲突处理）
    await safePushWithRetry(targetBranch, fullVersion);
  } catch (error) {
    const message = `提交和推送版本更改: ${error}`;
    logger.error(message);
    throw new ActionError(message, '提交和推送版本更改', error);
  }
}

/**
 * 安全推送，处理并发冲突
 */
async function safePushWithRetry(
  targetBranch: SupportedBranch,
  version: string,
  maxRetries = RETRY_CONFIG.MAX_ATTEMPTS,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        logger.info(`🔄 尝试推送 (第${attempt}/${maxRetries}次)`);
        // 拉取最新更改
        await execGit(['fetch', 'origin', targetBranch]);
        await execGit(['rebase', `origin/${targetBranch}`]);
      }

      // 推送分支和标签
      await execGit(['push', 'origin', targetBranch]);
      await execGit(['push', 'origin', version]);

      logger.info(`✅ 推送成功 (第${attempt}次尝试)`);
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`❌ 推送失败，已尝试${maxRetries}次: ${error}`);
        throw error;
      }

      logger.warning(`⚠️ 推送失败 (第${attempt}/${maxRetries}次)，可能存在并发冲突: ${error}`);

      // 等待随机时间避免竞态
      const delay = Math.random() * (RETRY_CONFIG.DELAY_MAX_MS - RETRY_CONFIG.DELAY_MIN_MS) + RETRY_CONFIG.DELAY_MIN_MS;
      logger.info(`⏳ 等待 ${Math.round(delay)}ms 后重试...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// ==================== 分支同步逻辑 ====================

/**
 * 检查是否为自动同步提交
 */
function isAutoSyncCommit(): boolean {
  // 检查最近的提交消息是否包含同步标记
  const commitMessage = context.payload.head_commit?.message || '';

  if (
    commitMessage.includes('[skip ci]') ||
    commitMessage.includes('chore: sync') ||
    commitMessage.includes('chore: bump version')
  ) {
    logger.info(`检测到自动提交: ${commitMessage}`);
    return true;
  }

  return false;
}

/**
 * 获取同步提交消息
 */
function getCommitMessage(sourceBranch: SupportedBranch, targetBranch: SupportedBranch, version: string): string {
  const { pkgVersion: cleanVersion, targetVersion: fullVersion } = versionParse(version);
  const prefix = VERSION_PREFIX_CONFIG.CURRENT;
  if (sourceBranch === 'main' && targetBranch === 'beta') {
    return COMMIT_TEMPLATES.SYNC_MAIN_TO_BETA(fullVersion);
  }
  return `chore: sync ${sourceBranch} ${prefix}${cleanVersion} to ${targetBranch} [skip ci]`;
}

/**
 * 同步上游分支到下游分支 (使用 rebase)
 */
async function syncDownstreamWithRebase(
  sourceBranch: SupportedBranch,
  targetBranch: SupportedBranch,
  sourceVersion: string,
): Promise<BranchSyncResult> {
  logger.info(`开始 rebase 同步 ${sourceBranch} -> ${targetBranch}`);

  try {
    // 切换到目标分支
    await execGit(['fetch', 'origin', targetBranch]);
    await execGit(['switch', targetBranch]);

    // 尝试 rebase 源分支
    try {
      await execGit(['rebase', sourceBranch]);
      logger.info(`${sourceBranch} -> ${targetBranch} rebase 成功`);
    } catch {
      logger.warning(`${sourceBranch} -> ${targetBranch} rebase 冲突，尝试处理`);

      // 对于 rebase 冲突，我们采用更保守的策略
      await execGit(['rebase', '--abort']);

      // 改用 merge 策略作为 fallback
      const commitMessage = getCommitMessage(sourceBranch, targetBranch, sourceVersion);
      await execGit(['merge', sourceBranch, '--no-edit', '--no-ff', '-m', commitMessage]);
      logger.info('rebase 失败，改用 merge 策略完成同步');
    }

    // 推送更改
    await execGit(['push', 'origin', targetBranch, '--force-with-lease']);
    logger.info(`${targetBranch} 分支 rebase 同步完成`);

    return { success: true, version: sourceVersion };
  } catch (error) {
    const errorMsg = `${sourceBranch} -> ${targetBranch} rebase 同步失败: ${error}`;
    logger.error(errorMsg);
    return {
      success: false,
      error: errorMsg,
      conflicts: [sourceBranch, targetBranch],
    };
  }
}

/**
 * 执行分支同步 - 根据新的合并策略
 */
export async function syncBranches(targetBranch: SupportedBranch, newVersion: string): Promise<BranchSyncResult[]> {
  // 🔧 修复：只有在 push 事件时才检查自动同步提交，PR merge 事件需要完整同步链
  const isPushEvent = context.eventName === 'push';
  if (isPushEvent && isAutoSyncCommit()) {
    logger.info('检测到 Push 事件的自动同步提交，跳过分支同步避免级联触发');
    return [{ success: true }];
  }

  const results: BranchSyncResult[] = [];

  if (targetBranch === 'main') {
    // Main 分支更新后：使用 rebase 向下游 Beta 分支同步
    logger.info('Main 分支更新，使用 rebase 向 Beta 分支同步');

    const betaResult = await syncDownstreamWithRebase('main', 'beta', newVersion);
    results.push(betaResult);

    if (!betaResult.success) {
      logger.warning('Main → Beta 同步失败');
    }
  }
  // Beta 分支不自动同步

  return results;
}

// ==================== 版本更新和标签创建 ====================

/**
 * 更新版本并创建标签 - 支持基于 PR 的 CHANGELOG 生成
 */
export async function updateVersionAndCreateTag(
  newVersion: string,
  targetBranch: SupportedBranch,
  pr: PRData | null = null,
): Promise<void> {
  try {
    logger.info('开始执行版本更新...');

    await execGit(['switch', targetBranch]);

    // 更新版本文件
    await updatePackageVersion(newVersion);

    // 更新 CHANGELOG - 使用 PR 信息
    await updateChangelog(pr, newVersion);

    // 检查是否有 CHANGELOG 更改需要提交 - 每次版本发布都必须有 CHANGELOG 变更
    const hasChanges = await hasChangelogChanges();
    if (hasChanges) {
      // 将版本文件与 CHANGELOG 合并到同一发布提交，再创建 tag
      await commitAndPushVersion(newVersion, targetBranch);
    } else {
      const errorMessage = 'CHANGELOG 未生成任何内容，这不应该发生。请检查 PR 描述或提交历史是否包含足够的变更信息。';
      logger.error(errorMessage);
      throw new ActionError(errorMessage, 'CHANGELOG 生成失败');
    }

    logger.info(`✅ 版本更新完成: ${newVersion}`);
  } catch (error) {
    throw new ActionError(`版本更新和标签创建失败: ${error}`, 'updateVersionAndCreateTag', error);
  }
}

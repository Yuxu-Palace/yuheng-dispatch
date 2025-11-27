import process from 'node:process';
import { context, getOctokit } from '@actions/github';
import { readPackageJSON, resolvePackageJSON, writePackageJSON } from 'pkg-types';
import { commitChangelog, hasChangelogChanges, updateChangelog } from './changelog';
import { COMMIT_TEMPLATES, ERROR_MESSAGES, GIT_USER_CONFIG } from './constants';
import { logger } from './core';
import { handleNpmPublish, verifyNpmPublishConfig } from './npm';
import type { BranchSyncResult, PRData, SupportedBranch } from './types';
import { ActionError, execGit, execGitWithOutput, versionParse } from './utils';
import { updatePackageVersion } from './version';

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
    const { pkgVersion: packageVersion, targetVersion: fullVersion } = versionParse(version);

    // 提交版本更改
    await execGit(['add', '.']);
    await execGit(['commit', '-m', COMMIT_TEMPLATES.VERSION_BUMP(packageVersion, targetBranch)]);

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
async function safePushWithRetry(targetBranch: SupportedBranch, version: string, maxRetries = 3): Promise<void> {
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
      const delay = Math.random() * 2000 + 1000; // 1-3秒随机延迟
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
  if (sourceBranch === 'main' && targetBranch === 'beta') {
    return COMMIT_TEMPLATES.SYNC_MAIN_TO_BETA(version);
  }
  if (sourceBranch === 'beta' && targetBranch === 'alpha') {
    return COMMIT_TEMPLATES.SYNC_BETA_TO_ALPHA(version);
  }
  return `chore: sync ${sourceBranch} v${version} to ${targetBranch} [skip ci]`;
}

/**
 * 手动解决版本相关冲突
 */
async function resolveVersionConflicts(
  sourceBranch: SupportedBranch,
  targetBranch: SupportedBranch,
  sourceVersion: string,
): Promise<void> {
  try {
    // 取消合并
    await execGit(['merge', '--abort']);

    // 只合并非冲突文件，跳过版本文件
    await execGit(['merge', sourceBranch, '--no-commit', '--no-ff']);

    // 手动处理 package.json 版本冲突
    const pkgPath = await resolvePackageJSON();
    const sourcePkg = await readPackageJSON(pkgPath);

    // 确定正确的版本号
    const correctVersion = sourceVersion.replace(/^v/, '');
    sourcePkg.version = correctVersion;

    await writePackageJSON(pkgPath, sourcePkg);
    await execGit(['add', 'package.json']);

    // 完成合并
    const commitMessage = `${getCommitMessage(sourceBranch, targetBranch, sourceVersion)} (resolved version conflicts)`;
    await execGit(['commit', '-m', commitMessage]);

    logger.info(`手动解决版本冲突完成: ${sourceBranch} -> ${targetBranch}`);
  } catch (error) {
    throw new ActionError(`手动解决版本冲突失败: ${error}`, 'resolveVersionConflicts', error);
  }
}

/**
 * 报告合并冲突，创建 issue
 */
async function reportMergeConflict(
  sourceBranch: SupportedBranch,
  targetBranch: SupportedBranch,
  sourceVersion: string,
): Promise<void> {
  try {
    const octokit = getOctokit(process.env.GITHUB_TOKEN || '');

    const issueTitle = `🔀 自动合并冲突: ${sourceBranch} -> ${targetBranch}`;
    const issueBody = `## 合并冲突报告

**源分支**: ${sourceBranch}
**目标分支**: ${targetBranch}  
**版本**: ${sourceVersion}
**时间**: ${new Date().toISOString()}

## 问题描述
自动合并过程中遇到无法自动解决的冲突，需要人工介入处理。

## 需要处理的步骤
1. 检查 ${targetBranch} 分支的本地修改
2. 手动合并 ${sourceBranch} 分支的更改
3. 解决版本冲突
4. 测试合并结果
5. 推送更改

## 自动化日志
详细日志请查看 GitHub Actions 运行记录。

---
*此 issue 由版本管理 Action 自动创建*`;

    await octokit.rest.issues.create({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: issueTitle,
      body: issueBody,
      labels: ['merge-conflict', 'automated', 'priority-high'],
    });

    logger.info(`已创建合并冲突 issue: ${issueTitle}`);
  } catch (error) {
    logger.error(`创建合并冲突 issue 失败: ${error}`);
  }
}

/**
 * 处理合并冲突 - 智能合并策略
 */
async function handleMergeConflict(
  sourceBranch: SupportedBranch,
  targetBranch: SupportedBranch,
  sourceVersion: string,
): Promise<void> {
  logger.warning(`${sourceBranch} -> ${targetBranch} 合并冲突，尝试智能处理`);

  try {
    // 第一步：尝试使用源分支的版本策略解决冲突
    await execGit(['merge', '--abort']); // 取消当前合并

    // 第二步：使用策略合并，优先采用源分支的版本文件
    await execGit([
      'merge',
      sourceBranch,
      '-X',
      'theirs',
      '--no-edit',
      '-m',
      `${getCommitMessage(sourceBranch, targetBranch, sourceVersion)} (auto-resolved conflicts)`,
    ]);

    logger.info(`使用策略合并成功解决 ${sourceBranch} -> ${targetBranch} 冲突`);
  } catch (strategyError) {
    logger.warning(`策略合并失败，尝试手动解决版本冲突: ${strategyError}`);

    try {
      // 第三步：手动解决版本相关冲突
      await resolveVersionConflicts(sourceBranch, targetBranch, sourceVersion);
    } catch (manualError) {
      logger.error(`手动解决冲突失败: ${manualError}`);

      // 第四步：最后手段 - 创建 issue 报告冲突
      await reportMergeConflict(sourceBranch, targetBranch, sourceVersion);
      throw new ActionError(ERROR_MESSAGES.MERGE_CONFLICT(sourceBranch, targetBranch), 'handleMergeConflict');
    }
  }
}

/**
 * 同步上游分支到下游分支 (使用 merge)
 */
async function syncDownstream(
  sourceBranch: SupportedBranch,
  targetBranch: SupportedBranch,
  sourceVersion: string,
): Promise<BranchSyncResult> {
  logger.info(`开始 merge 同步 ${sourceBranch} -> ${targetBranch}`);

  try {
    // 切换到目标分支
    await execGit(['fetch', 'origin', targetBranch]);
    await execGit(['switch', targetBranch]);

    // 尝试合并源分支
    const commitMessage = getCommitMessage(sourceBranch, targetBranch, sourceVersion);

    try {
      await execGit(['merge', sourceBranch, '--no-edit', '--no-ff', '-m', commitMessage]);
      logger.info(`${sourceBranch} -> ${targetBranch} merge 成功`);
    } catch {
      logger.warning(`${sourceBranch} -> ${targetBranch} merge 冲突，进行强制同步`);
      await handleMergeConflict(sourceBranch, targetBranch, sourceVersion);
    }

    // 推送更改
    await execGit(['push', 'origin', targetBranch, '--force-with-lease']);
    logger.info(`${targetBranch} 分支 merge 同步完成`);

    return { success: true, version: sourceVersion };
  } catch (error) {
    const errorMsg = `${sourceBranch} -> ${targetBranch} merge 同步失败: ${error}`;
    logger.error(errorMsg);
    return {
      success: false,
      error: errorMsg,
      conflicts: [sourceBranch, targetBranch],
    };
  }
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

    if (betaResult.success) {
      // Beta 分支同步成功后，继续向 Alpha 分支 merge
      logger.info('Main → Beta 同步成功，继续 Beta → Alpha merge 同步');
      const alphaResult = await syncDownstream('beta', 'alpha', newVersion);
      results.push(alphaResult);
    } else {
      logger.warning('Main → Beta 同步失败，跳过 Beta → Alpha 级联同步');
    }
  } else if (targetBranch === 'beta') {
    // Beta 分支更新后：使用 merge 向下游 Alpha 分支同步
    logger.info('Beta 分支更新，使用 merge 向 Alpha 分支同步');
    const result = await syncDownstream('beta', 'alpha', newVersion);
    results.push(result);
  }
  // Alpha 分支更新时不自动同步，需要手动 PR 到 Beta

  return results;
}

// ==================== 版本更新和标签创建 ====================

interface ReleaseRollbackContext {
  versionCommitSha: string | null;
  changelogCommitSha: string | null;
  tagName: string;
  targetBranch: SupportedBranch;
  tagCreated: boolean;
  rollbackCompleted: boolean; // 标记回滚是否已完成，确保幂等性
}

async function deleteTagIfExists(tagName: string, tagCreated: boolean): Promise<void> {
  if (!(tagName && tagCreated)) {
    return;
  }

  try {
    await execGit(['tag', '-d', tagName]);
    logger.info(`已删除本地标签: ${tagName}`);
  } catch (error) {
    logger.warning(`删除本地标签 ${tagName} 失败（可能不存在）: ${error}`);
  }

  try {
    await execGit(['push', 'origin', `:refs/tags/${tagName}`]);
    logger.info(`已删除远程标签: ${tagName}`);
  } catch (error) {
    logger.warning(`删除远程标签 ${tagName} 失败（可能不存在）: ${error}`);
  }
}

async function rollbackRelease(releaseContext: ReleaseRollbackContext): Promise<void> {
  const { versionCommitSha, changelogCommitSha, tagName, targetBranch, tagCreated, rollbackCompleted } = releaseContext;

  if (rollbackCompleted) {
    logger.info('回滚已完成，跳过重复执行');
    return;
  }

  if (!(versionCommitSha || changelogCommitSha)) {
    logger.info('未检测到需要回滚的提交，跳过回滚流程');
    await deleteTagIfExists(tagName, tagCreated);
    releaseContext.rollbackCompleted = true;
    return;
  }

  logger.warning('检测到 npm 发布失败，开始回滚版本提交和标签');

  try {
    await execGit(['switch', targetBranch]);
  } catch (error) {
    logger.warning(`回滚流程切换至 ${targetBranch} 分支失败: ${error}`);
  }

  const commitsToRevert: string[] = [];
  if (changelogCommitSha) {
    commitsToRevert.push(changelogCommitSha);
  }
  if (versionCommitSha) {
    commitsToRevert.push(versionCommitSha);
  }

  for (let i = 0; i < commitsToRevert.length; i++) {
    const commitSha = commitsToRevert[i];
    try {
      await execGit(['revert', '--no-edit', commitSha]);
      logger.info(`已回滚提交 ${commitSha}`);
    } catch (error) {
      logger.error(`回滚提交 ${commitSha} 失败: ${error}`);
      try {
        await execGit(['revert', '--abort']);
      } catch (abortError) {
        logger.warning(`执行 revert --abort 时出错（可能无进行中的回滚）: ${abortError}`);
      }
      throw new ActionError(`回滚提交 ${commitSha} 失败，需要人工介入: ${error}`, 'rollbackRelease', error);
    }
  }

  try {
    await execGit(['push', 'origin', targetBranch]);
    logger.info(`已推送回滚提交到 ${targetBranch}`);
  } catch (error) {
    throw new ActionError(`推送回滚提交到远程失败: ${error}`, 'rollbackRelease', error);
  }

  await deleteTagIfExists(tagName, tagCreated);

  releaseContext.rollbackCompleted = true;
}

/**
 * 更新版本并创建标签 - 支持基于 PR 的 CHANGELOG 生成和 npm 发布
 */
export async function updateVersionAndCreateTag(
  newVersion: string,
  targetBranch: SupportedBranch,
  pr: PRData | null = null,
): Promise<void> {
  const parsedVersion = versionParse(newVersion);
  const rollbackContext: ReleaseRollbackContext = {
    versionCommitSha: null,
    changelogCommitSha: null,
    tagName: parsedVersion.targetVersion,
    targetBranch,
    tagCreated: false,
    rollbackCompleted: false,
  };

  try {
    logger.info('开始执行版本更新...');

    await execGit(['switch', targetBranch]);

    // 🔒 预检查：在打 tag 前验证 npm 认证（如果启用了发布）
    await verifyNpmPublishConfig();

    // 更新版本文件
    await updatePackageVersion(newVersion);

    // 提交版本更改并推送（创建 tag）
    await commitAndPushVersion(newVersion, targetBranch);
    rollbackContext.tagCreated = true;
    rollbackContext.versionCommitSha = await execGitWithOutput(['rev-parse', 'HEAD']);

    // 🎯 在打 tag 后更新 CHANGELOG - 使用 PR 信息
    await updateChangelog(pr, newVersion);

    // 检查是否有 CHANGELOG 更改需要提交 - 每次版本发布都必须有 CHANGELOG 变更
    const hasChanges = await hasChangelogChanges();
    if (hasChanges) {
      await commitChangelog(newVersion, targetBranch);
      rollbackContext.changelogCommitSha = await execGitWithOutput(['rev-parse', 'HEAD']);
    } else {
      const errorMessage = 'CHANGELOG 未生成任何内容，这不应该发生。请检查 PR 描述或提交历史是否包含足够的变更信息。';
      logger.error(errorMessage);
      throw new ActionError(errorMessage, 'CHANGELOG 生成失败');
    }

    // 🚀 发布到 npm - 只对目标分支版本发布
    // 注意：如果发布失败，tag 已经创建，可以稍后手动重新发布
    const publishSucceeded = await handleNpmPublish(newVersion, targetBranch);

    if (!publishSucceeded) {
      await rollbackRelease(rollbackContext);
      logger.warning('⚠️  npm 发布失败，已自动回滚版本提交和标签。后续建议：');
      logger.warning('   1. 修复发布问题后重新触发版本流程');
      logger.warning('   2. 如需立即发布，可在本地验证后重新运行预期流程');
    }
  } catch (error) {
    if (rollbackContext.versionCommitSha || rollbackContext.changelogCommitSha) {
      try {
        await rollbackRelease(rollbackContext);
      } catch (rollbackError) {
        logger.error(`自动回滚流程失败，需要人工处理: ${rollbackError}`);
      }
    }
    throw new ActionError(`版本更新和标签创建失败: ${error}`, 'updateVersionAndCreateTag', error);
  }
}

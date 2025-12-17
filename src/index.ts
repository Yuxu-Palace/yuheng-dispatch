import process from 'node:process';
import { context } from '@actions/github';
import { configureGitUser, syncBranches, updateVersionAndCreateTag } from './core/git';
import { calculateNewVersion, getBaseVersion } from './core/version';
import { logger, setFailed, setOutput } from './github/actions';
import { createErrorComment, getCurrentPRNumber, handlePreviewMode } from './github/pr';
import { ActionError, isSupportedBranch } from './utils';
import type { PRData, PRWorkflowInfo, SupportedBranch } from './utils/types';

// ==================== 主执行函数 ====================

/**
 * 处理执行模式逻辑
 */
async function handleExecutionMode(
  newVersion: string,
  targetBranch: SupportedBranch,
  pr: PRData | null,
): Promise<void> {
  await updateVersionAndCreateTag(newVersion, targetBranch, pr);
  const syncResults = await syncBranches(targetBranch, newVersion);

  // 检查同步结果
  const failedSyncs = syncResults.filter((result) => !result.success);
  if (failedSyncs.length > 0) {
    logger.warning(`部分分支同步失败: ${failedSyncs.map((result) => result.error).join(', ')}`);
  }
}

/**
 * 验证事件类型并提取 PR 信息
 */
function validateAndExtractPRInfo(): PRWorkflowInfo | null {
  if (context.eventName !== 'pull_request' && context.eventName !== 'pull_request_target') {
    throw new ActionError(`只支持 pull_request 事件，当前事件: ${context.eventName}`, 'validateEvent');
  }

  const prPayload = context.payload.pull_request;
  if (!prPayload) {
    throw new ActionError('PR payload 不存在', 'extractPRInfo');
  }

  const targetBranch = prPayload.base.ref;
  const sourceBranch = prPayload.head.ref;
  const prNumber = prPayload.number;

  // 类型守卫：确保 targetBranch 是支持的分支类型；不支持时直接跳过而非抛错
  if (!isSupportedBranch(targetBranch)) {
    logger.info(`不支持的分支: ${targetBranch}，跳过版本管理`);
    return null;
  }

  const pr = prPayload as PRData;
  const isMerged = prPayload.state === 'closed' && prPayload.merged === true;
  const isDryRun = !isMerged;
  const eventType = isMerged ? 'merge' : 'preview';

  return {
    pr,
    sourceBranch,
    targetBranch,
    prNumber,
    isMerged,
    isDryRun,
    eventType,
  };
}

/**
 * 打印调试信息
 */
function printDebugInfo(info: PRWorkflowInfo): void {
  const runId = process.env.GITHUB_RUN_ID;
  const runNumber = process.env.GITHUB_RUN_NUMBER;

  logger.info('🔍 ===== Action 运行实例信息 =====');
  logger.info(`  - Action 运行 ID: ${runId}`);
  logger.info(`  - Action 运行编号: ${runNumber}`);
  logger.info(`  - 工作流名称: ${process.env.GITHUB_WORKFLOW}`);
  logger.info(`  - 事件类型: ${context.eventName}`);
  logger.info(`  - 事件动作: ${context.payload.action}`);
  logger.info('🔍 ===== PR 信息 =====');
  logger.info(`  - prNumber: ${info.prNumber}`);
  logger.info(`  - 源分支 (head.ref): ${info.sourceBranch}`);
  logger.info(`  - 目标分支 (base.ref): ${info.targetBranch}`);
  logger.info(`  - PR 标题: ${info.pr.title || '无'}`);
  logger.info(`  - PR URL: ${info.pr.html_url || '无'}`);
  logger.info('🔍 ===== Context 完整信息 =====');
  logger.info(`  - context.sha: ${context.sha}`);
  logger.info(`  - context.ref: ${context.ref}`);
  logger.info(`  - context.payload keys: ${Object.keys(context.payload).join(', ')}`);
}

/**
 * 处理版本计算逻辑
 */
async function processVersionCalculation(
  info: PRWorkflowInfo,
): Promise<{ baseVersion: string | null; newVersion: string | null }> {
  // 配置 Git 用户信息
  await configureGitUser();

  // 获取基础版本（用于显示当前版本）
  const baseVersion = await getBaseVersion(info.targetBranch, info.sourceBranch, info.pr);

  // 根据分支策略计算新版本号（策略内部自行判断是否需要 PR 标签）
  const newVersion = await calculateNewVersion(info.targetBranch, info.sourceBranch, info.pr);

  // 改进日志输出，提供更多调试信息
  if (newVersion) {
    logger.info(`🎯 ${info.isDryRun ? '预览' : '新'}版本: ${newVersion}`);
  } else {
    logger.warning(
      `⚠️ 版本计算结果为空 - 合并方向: ${info.sourceBranch} → ${info.targetBranch}, 基础版本: ${baseVersion || '无'}`,
    );
  }

  return { baseVersion, newVersion };
}

/**
 * 预览模式流程
 */
async function runPreviewWorkflow(
  info: PRWorkflowInfo,
  baseVersion: string | null,
  newVersion: string | null,
): Promise<void> {
  logger.info('📝 执行预览模式...');
  await handlePreviewMode(info.pr, info.sourceBranch, info.targetBranch, baseVersion, newVersion);
  setOutput('preview-version', newVersion || '');
  setOutput('is-preview', 'true');
}

/**
 * 执行模式流程
 */
async function runExecutionWorkflow(
  info: PRWorkflowInfo,
  baseVersion: string | null,
  newVersion: string | null,
): Promise<void> {
  logger.info('🚀 执行版本更新模式...');

  if (!newVersion) {
    logger.info(
      `ℹ️ 无需版本升级 - 合并方向: ${info.sourceBranch} → ${info.targetBranch}, 当前版本: ${baseVersion || '无'}`,
    );
    setOutput('next-version', '');
    setOutput('is-preview', 'false');
    return;
  }

  await handleExecutionMode(newVersion, info.targetBranch, info.pr);
  setOutput('next-version', newVersion);
  setOutput('is-preview', 'false');
  logger.info(`✅ 版本更新完成: ${newVersion}`);
}

/**
 * 执行工作流程
 */
async function executeWorkflow(
  info: PRWorkflowInfo,
  baseVersion: string | null,
  newVersion: string | null,
): Promise<void> {
  if (info.isDryRun) {
    await runPreviewWorkflow(info, baseVersion, newVersion);
    return;
  }
  await runExecutionWorkflow(info, baseVersion, newVersion);
}

/**
 * 处理错误并创建 PR 评论
 */
async function handleWorkflowError(error: unknown): Promise<void> {
  let errorMessage = '';
  if (error instanceof ActionError) {
    errorMessage = `${error.context}: ${error.message}`;
    logger.error(`Action 执行失败: ${error.message} (${error.context})`);
    setFailed(errorMessage);
  } else {
    errorMessage = String(error);
    logger.error(`未知错误: ${error}`);
    setFailed(errorMessage);
  }

  // 尝试在 PR 中创建错误评论（如果存在 PR）
  try {
    const prPayload = context.payload.pull_request;
    if (prPayload) {
      const prNumber = getCurrentPRNumber(prPayload as PRData);
      if (prNumber) {
        await createErrorComment(prNumber, errorMessage);
        logger.info(`已在 PR #${prNumber} 创建错误评论`);
      }
    }
  } catch (commentError) {
    logger.warning(`创建错误评论失败: ${commentError}`);
  }
}

/**
 * 主执行函数 - 自动版本升级和分支同步
 */
async function run(): Promise<void> {
  try {
    // 1. 验证事件并提取 PR 信息
    const workflowInfo = validateAndExtractPRInfo();
    if (!workflowInfo) {
      // 不支持的分支：直接跳过，设置空输出以保持一致
      setOutput('preview-version', '');
      setOutput('next-version', '');
      setOutput('is-preview', 'true');
      return;
    }

    // 2. 打印调试信息
    printDebugInfo(workflowInfo);

    logger.info(
      `分支合并方向: ${workflowInfo.sourceBranch} → ${workflowInfo.targetBranch} (${workflowInfo.eventType}模式${workflowInfo.isDryRun ? ' - 预览' : ' - 执行'})`,
    );

    // 3. 处理版本计算
    const { baseVersion, newVersion } = await processVersionCalculation(workflowInfo);

    // 4. 执行工作流程
    await executeWorkflow(workflowInfo, baseVersion, newVersion);
  } catch (error: unknown) {
    await handleWorkflowError(error);
  }
}

// ==================== 执行入口 ====================

void run();

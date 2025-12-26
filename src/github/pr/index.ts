import { context, getOctokit } from '@actions/github';
import { getInput, logger } from '@/github/actions';
import { COMMENT_CONFIG, COMMENT_TEMPLATES, PAGINATION_CONFIG } from '@/utils/constants';
import type { IssueComment, PRData, SupportedBranch, VersionPreviewData } from '@/utils/types';

// ==================== GitHub API 客户端 ====================

/** 初始化 GitHub API 客户端 */
const octokit = getOctokit(getInput('token', { required: true }));

// ==================== PR 工具函数 ====================

/**
 * 获取当前 PR 号（优先使用 payload 数据）
 */
export function getCurrentPRNumber(pr: PRData | null): number | null {
  return context.payload.pull_request?.number || pr?.number || null;
}

// ==================== PR 信息获取 ====================

// ==================== PR 评论管理 ====================

/**
 * 创建或更新 PR 评论
 */
export async function updatePRComment(
  prNumber: number,
  commentBody: string,
  identifier = `## ${COMMENT_CONFIG.TITLE}`,
): Promise<void> {
  try {
    let existingComment: IssueComment | undefined;

    for await (const { data: comments } of octokit.paginate.iterator(octokit.rest.issues.listComments, {
      owner: context.repo.owner,
      repo: context.repo.repo,
      // biome-ignore lint/style/useNamingConvention: GitHub API requires this property name
      issue_number: prNumber,
      // biome-ignore lint/style/useNamingConvention: GitHub API requires this property name
      per_page: PAGINATION_CONFIG.COMMENTS_PER_PAGE,
    })) {
      existingComment = comments.find((comment) => comment.user?.type === 'Bot' && comment.body?.includes(identifier));

      if (existingComment) {
        break;
      }
    }

    if (existingComment) {
      await octokit.rest.issues.updateComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        // biome-ignore lint/style/useNamingConvention: GitHub API requires this property name
        comment_id: existingComment.id,
        body: commentBody,
      });
      logger.info(`已更新 PR #${prNumber} 的评论`);
    } else {
      await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        // biome-ignore lint/style/useNamingConvention: GitHub API requires this property name
        issue_number: prNumber,
        body: commentBody,
      });
      logger.info(`已在 PR #${prNumber} 创建评论`);
    }
  } catch (error) {
    logger.warning(`更新 PR 评论失败: ${error}`);
  }
}

/**
 * 创建错误评论
 */
export async function createErrorComment(prNumber: number, errorMessage: string): Promise<void> {
  try {
    const commentBody = COMMENT_TEMPLATES.ERROR(errorMessage);
    await updatePRComment(prNumber, commentBody);
  } catch (error) {
    logger.warning(`创建错误评论失败: ${error}`);
  }
}

/**
 * 处理预览模式 - 在 PR 中显示版本预览信息
 */
export async function handlePreviewMode(
  pr: PRData | null,
  sourceBranch: string,
  targetBranch: SupportedBranch,
  baseVersion: string | null,
  newVersion: string | null,
): Promise<void> {
  const prNumber = getCurrentPRNumber(pr);
  if (!prNumber) {
    logger.warning('无法获取 PR 号，跳过评论更新');
    return;
  }

  // 构建版本预览数据
  const previewData: VersionPreviewData = {
    sourceBranch,
    targetBranch,
    currentVersion: baseVersion || undefined,
    nextVersion: newVersion || '无需升级',
  };

  // 根据是否有新版本选择合适的模板
  const commentBody = newVersion
    ? COMMENT_TEMPLATES.VERSION_PREVIEW(previewData)
    : COMMENT_TEMPLATES.VERSION_SKIP(targetBranch, baseVersion);

  // 更新 PR 评论
  await updatePRComment(prNumber, commentBody);
  logger.info(`已更新 PR #${prNumber} 的版本预览信息`);
}

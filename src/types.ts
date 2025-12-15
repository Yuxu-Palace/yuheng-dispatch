import type { getOctokit } from '@actions/github';

// ==================== 基础类型定义 ====================

export type SupportedBranch = 'main' | 'beta';

export type PRData = Awaited<ReturnType<ReturnType<typeof getOctokit>['rest']['pulls']['get']>>['data'];

export type IssueComment = Awaited<
  ReturnType<ReturnType<typeof getOctokit>['rest']['issues']['listComments']>
>['data'][number];

export interface VersionInfo {
  current: string;
  beta: string;
  currentTag: string | null;
  betaTag: string | null;
}

export interface VersionPreviewData {
  sourceBranch: string;
  targetBranch: SupportedBranch;
  currentVersion?: string;
  nextVersion: string;
  pkgPrNewUrl?: string;
}

// ==================== 工具函数类型 ====================

export interface VersionSummary {
  original: string;
  normalized: string;
  clean: string;
  hasPrefix: boolean;
  isValid: boolean;
  prefix: string;
}

export interface BranchSyncResult {
  success: boolean;
  conflicts?: string[];
  version?: string;
  error?: string;
}

/** 工作流内部事件枚举（非 GitHub Webhook 事件名） */
export type PRWorkflowEventType = 'merge' | 'preview';

export interface PRWorkflowInfo {
  readonly pr: PRData;
  readonly sourceBranch: string;
  readonly targetBranch: SupportedBranch;
  readonly prNumber: PRData['number'];
  readonly isMerged: boolean;
  readonly isDryRun: boolean;
  readonly eventType: PRWorkflowEventType;
}

import type { getOctokit } from '@actions/github';

// ==================== 基础类型定义 ====================

export type SupportedBranch = 'main' | 'beta' | 'alpha';

export type PRData = Awaited<ReturnType<ReturnType<typeof getOctokit>['rest']['pulls']['get']>>['data'];

export interface VersionInfo {
  current: string;
  beta: string;
  currentTag: string | null;
  betaTag: string | null;
}

// export interface EventInfo {
//   targetBranch: SupportedBranch;
//   isDryRun: boolean;
//   pr: PRData | null;
// }

export interface VersionPreviewData {
  sourceBranch: string;
  targetBranch: string;
  currentVersion?: string;
  nextVersion: string;
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

export interface PRWorkflowInfo {
  pr: PRData;
  sourceBranch: string;
  targetBranch: SupportedBranch;
  prNumber: number;
  isMerged: boolean;
  isDryRun: boolean;
  eventType: string;
}

// export function isValidReleaseType(type: string): type is ReleaseType {
//   return ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'].includes(type);
// }

// export interface ErrorContext {
//   operation: string;
//   branch?: string;
//   version?: string;
//   pr?: number;
// }

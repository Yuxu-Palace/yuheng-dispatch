import type { getOctokit } from '@actions/github';
import type { ReleaseType } from 'semver';
import { SUPPORTED_BRANCHES } from './constants';

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

// ==================== 常用类型守卫 ====================

export function isSupportedBranch(branch: string): branch is SupportedBranch {
  return SUPPORTED_BRANCHES.includes(branch);
}

// export function isValidReleaseType(type: string): type is ReleaseType {
//   return ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'].includes(type);
// }

// ==================== 错误处理类型 ====================

export class ActionError extends Error {
  constructor(
    message: string,
    public readonly context: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'ActionError';
  }
}

// export interface ErrorContext {
//   operation: string;
//   branch?: string;
//   version?: string;
//   pr?: number;
// }

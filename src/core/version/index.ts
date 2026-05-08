import { readPackageJSON, resolvePackageJSON, writePackageJSON } from 'pkg-types';
import semver, { type ReleaseType } from 'semver';
import { logger } from '@/github/actions';
import { createErrorComment, getCurrentPRNumber } from '@/github/pr';
import {
  ActionError,
  addVersionPrefix,
  cleanVersion,
  execGitWithOutput,
  getVersionPrefix,
  hasVersionPrefix,
  normalizeVersion,
} from '@/utils';
import { DEFAULT_VERSIONS } from '@/utils/constants';
import type { PRData, SupportedBranch, VersionSummary } from '@/utils/types';

// ==================== 版本管理辅助函数 ====================

/**
 * 抛出错误并创建 PR 评论（如果有 PR）
 */
async function throwErrorWithComment(
  errorMsg: string,
  context: string,
  pr: PRData | null = null,
  originalError?: unknown,
): Promise<never> {
  // 尝试创建 PR 评论
  if (pr) {
    const prNumber = getCurrentPRNumber(pr);
    if (prNumber) {
      try {
        await createErrorComment(prNumber, errorMsg);
        logger.info(`已在 PR #${prNumber} 创建错误评论`);
      } catch (commentError) {
        logger.warning(`创建 PR 错误评论失败: ${commentError}`);
      }
    }
  }

  // 抛出原始错误
  throw new ActionError(errorMsg, context, originalError);
}

// ==================== 版本工具函数 ====================

/**
 * 从 PR 标签获取发布类型
 */
export function getReleaseTypeFromLabels(labels: { name: string }[] = []): ReleaseType | null {
  const labelNames = labels.map((label) => label.name);

  if (labelNames.includes('major')) {
    logger.info('检测到 major 标签，使用 premajor 发布类型');
    return 'premajor';
  }
  if (labelNames.includes('minor')) {
    logger.info('检测到 minor 标签，使用 preminor 发布类型');
    return 'preminor';
  }
  if (labelNames.includes('patch')) {
    logger.info('检测到 patch 标签，使用 prepatch 发布类型');
    return 'prepatch';
  }

  return null;
}

/**
 * 安全解析版本号（处理不规范的 prerelease 格式）
 */
export function parseVersion(version: string): semver.SemVer | null {
  let cleanedVersion = cleanVersion(version);

  // 修复不规范的 prerelease 格式（如 1.0.0-0-alpha.0 -> 1.0.0-alpha.0）
  cleanedVersion = cleanedVersion.replace(/-0-(alpha|beta)\./, '-$1.');

  return semver.parse(cleanedVersion);
}

/**
 * 获取版本的基础版本号（不含预发布标识）
 */
export function getBaseVersionString(version: string): string {
  const parsed = parseVersion(version);
  if (!parsed) {
    return '0.0.0';
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/**
 * 比较两个版本的基础版本号
 */
export function compareBaseVersions(version1: string, version2: string): number {
  const base1 = getBaseVersionString(version1);
  const base2 = getBaseVersionString(version2);
  if (semver.gt(base1, base2)) {
    return 1;
  }
  if (semver.lt(base1, base2)) {
    return -1;
  }
  return 0;
}

/**
 * 获取版本的分支类型
 */
export function getBranchType(version: string): string {
  const parsed = parseVersion(version);
  if (!(parsed && parsed.prerelease) || parsed.prerelease.length === 0) {
    return 'release';
  }
  return parsed.prerelease[0] as string;
}

/**
 * 创建默认版本（带正确前缀）
 */
export function createDefaultVersion(type: keyof typeof DEFAULT_VERSIONS = 'BASE'): string {
  return addVersionPrefix(DEFAULT_VERSIONS[type]);
}

/**
 * 验证版本号格式是否正确
 */
export function isValidVersion(version: string): boolean {
  const cleaned = cleanVersion(version);
  return semver.valid(cleaned) !== null;
}

/**
 * 获取版本信息摘要（用于日志记录）
 */
export function getVersionSummary(version: string): VersionSummary {
  const prefix = getVersionPrefix();
  const hasPrefix = hasVersionPrefix(version);
  const clean = cleanVersion(version);
  const normalized = normalizeVersion(version);
  const isValid = isValidVersion(version);

  return {
    original: version,
    normalized,
    clean,
    hasPrefix,
    isValid,
    prefix,
  };
}

// ==================== 版本缓存机制 ====================

/**
 * 版本缓存接口
 */
interface VersionCache {
  main?: string | null;
  beta?: string | null;
}

/**
 * 版本管理器 - 统一版本查询和缓存
 */
class VersionManager {
  private cache: VersionCache = {};
  private isInitialized = false;

  private async getAllTags(): Promise<string[]> {
    const prefix = getVersionPrefix();
    // 使用 --sort=-creatordate 按创建时间倒序排列，最新的 tag 在前面
    const stdout = await execGitWithOutput(['tag', '-l', `${prefix}*`, '--sort=-creatordate']);
    return stdout.split('\n').filter((tag) => tag.trim().length > 0);
  }

  private parseMainVersion(tags: string[]): string | null {
    const latest = tags.find((tag) => !tag.includes('-')) || null;
    return latest ? normalizeVersion(latest) : null;
  }

  private parseBranchVersion(tags: string[], branchSuffix: string): string | null {
    const latest = tags.find((tag) => tag.includes(`-${branchSuffix}.`)) || null;
    return latest ? normalizeVersion(latest) : null;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    logger.info('🔍 初始化版本信息...');

    // 一次性获取所有标签，避免重复查询
    const allTags = await this.getAllTags();

    if (allTags.length === 0) {
      logger.info('📝 未找到任何版本标签，将使用默认版本');
    } else {
      logger.info(`📋 找到 ${allTags.length} 个版本标签`);
    }

    // 解析各分支的最新版本
    this.cache.main = this.parseMainVersion(allTags);
    this.cache.beta = this.parseBranchVersion(allTags, 'beta');

    logger.info(`📊 版本概览: main=${this.cache.main || '无'}, beta=${this.cache.beta || '无'}`);

    this.isInitialized = true;
  }

  async getLatestVersion(branch: 'main' | 'beta'): Promise<string | null> {
    await this.initialize();
    return this.cache[branch] || null;
  }

  async getGlobalHighestVersion(): Promise<string> {
    await this.initialize();

    const versions = [this.cache.main, this.cache.beta].filter(Boolean);

    if (versions.length === 0) {
      return createDefaultVersion('BASE');
    }

    // 找到最高的基础版本号
    let highestBaseVersion = '0.0.0';
    for (let i = 0; i < versions.length; i++) {
      const version = versions[i];
      if (version) {
        const baseVersion = getBaseVersionString(version);
        if (semver.gt(baseVersion, highestBaseVersion)) {
          highestBaseVersion = baseVersion;
        }
      }
    }

    const result = addVersionPrefix(highestBaseVersion);
    logger.info(`🏆 全局最高基础版本: ${result}`);
    return result;
  }

  async getLatestTag(): Promise<string | null> {
    const allTags = await this.getAllTags();
    return allTags.length > 0 ? allTags[0] : null;
  }

  getTagType(tag: string): 'release' | 'beta' | 'unknown' {
    if (!tag) {
      return 'unknown';
    }

    if (tag.includes('-beta.')) {
      return 'beta';
    }
    if (!tag.includes('-')) {
      return 'release';
    }
    return 'unknown';
  }

  clearCache(): void {
    this.cache = {};
    this.isInitialized = false;
  }
}

// 全局版本管理器实例
const versionManager = new VersionManager();

// ==================== 版本状态验证 ====================

/**
 * 验证目标分支是否允许进行版本升级（基于最新 tag 状态）
 */
async function validateBranchVersionState(targetBranch: SupportedBranch, pr: PRData | null = null): Promise<void> {
  const latestTag = await versionManager.getLatestTag();

  if (!latestTag) {
    // 没有任何 tag，允许任何分支开始
    logger.info(`📋 项目无版本标签，允许 ${targetBranch} 分支开始开发`);
    return;
  }

  const latestTagType = versionManager.getTagType(latestTag);
  logger.info(`📋 最新版本标签: ${latestTag} (类型: ${latestTagType})`);

  // 基于最新 tag 类型和目标分支检查是否允许
  const branchValidationRules: Record<SupportedBranch, { allowedTypes: string[]; errorMsg: string }> = {
    beta: {
      allowedTypes: ['release', 'beta'],
      errorMsg: 'Beta 分支只能在正式版本或 Beta 版本后继续开发',
    },
    main: {
      allowedTypes: ['beta', 'release'],
      errorMsg: 'Main 分支只能在 Beta 测试完成后或 Hotfix 紧急修复时发布',
    },
  };

  const rule = branchValidationRules[targetBranch];
  if (!rule.allowedTypes.includes(latestTagType)) {
    const errorMsg = `${rule.errorMsg}，当前最新版本: ${latestTag} (${latestTagType})`;
    logger.error(`❌ ${errorMsg}`);
    await throwErrorWithComment(errorMsg, 'validateBranchVersionState', pr);
  }

  logger.info(`✅ ${targetBranch} 分支允许在当前版本状态 (${latestTagType}) 下进行开发`);
}

// ==================== 版本升级规则定义 ====================

/**
 * 版本升级策略接口
 */
interface VersionUpgradeStrategy {
  canHandle(context: VersionUpgradeContext): boolean;
  execute(context: VersionUpgradeContext): string | null | Promise<string | null>;
  description: string;
}

/**
 * 版本升级上下文
 */
interface VersionUpgradeContext {
  baseVersion: string;
  targetBranch: SupportedBranch;
  sourceBranch: string;
  currentBranchType: string;
  parsed: semver.SemVer;
  pr: PRData | null;
}

/**
 * 创建版本升级上下文
 */
function createUpgradeContext(
  baseVersion: string,
  targetBranch: SupportedBranch,
  sourceBranch: string,
  pr: PRData | null,
): VersionUpgradeContext | null {
  const parsed = parseVersion(baseVersion);
  if (!parsed) {
    return null;
  }

  const isPrerelease = parsed.prerelease && parsed.prerelease.length > 0;
  const currentBranchType = isPrerelease ? (parsed.prerelease[0] as string) : 'release';

  return {
    baseVersion: cleanVersion(baseVersion),
    targetBranch,
    sourceBranch,
    currentBranchType,
    parsed,
    pr,
  };
}

/**
 * Beta 分支策略 - 基于 PR 标签处理版本升级（接受任意功能分支）
 */
class BetaStrategy implements VersionUpgradeStrategy {
  description = 'Beta 分支基于 PR 标签处理版本升级（接受任意功能分支）';

  private async calculateBetaVersion(context: VersionUpgradeContext, releaseType: ReleaseType): Promise<string> {
    const { baseVersion } = context;

    // 获取 Main 分支的版本作为基础
    const mainVersion = await versionManager.getLatestVersion('main');
    const mainBaseVersion = mainVersion ? getBaseVersionString(mainVersion) : '0.0.0';

    // 将 prerelease 类型转换为对应的正式版本类型
    const releaseTypeMapping: Record<string, ReleaseType> = {
      premajor: 'major',
      preminor: 'minor',
      prepatch: 'patch',
    };
    const baseReleaseType: ReleaseType = releaseTypeMapping[releaseType] || releaseType;

    // 根据标签类型从 Main 版本推导目标基础版本号
    const targetBaseVersion = semver.inc(mainBaseVersion, baseReleaseType);
    if (!targetBaseVersion) {
      logger.error(`无法根据标签 ${releaseType} 从 Main 版本 ${mainBaseVersion} 推导目标版本`);
      return baseVersion;
    }

    logger.info(`🏷️ 根据标签 ${releaseType} 从 Main 版本推导目标版本: ${mainBaseVersion} -> ${targetBaseVersion}`);

    // 获取当前 Beta 分支的最新版本
    const currentBetaVersion = await versionManager.getLatestVersion('beta');
    const currentBetaBaseVersion = currentBetaVersion ? getBaseVersionString(currentBetaVersion) : '0.0.0';

    // 判断 Beta 基础号与 Main 基础号的关系
    if (currentBetaBaseVersion === mainBaseVersion) {
      // Beta 基础号与 Main 一致，说明是新功能进入 Beta 测试，直接使用目标版本
      const newBetaVersion = `${targetBaseVersion}-beta.0`;
      logger.info(`🆕 Beta 基础号与 Main 一致，创建新功能 Beta 版本: ${newBetaVersion}`);
      return newBetaVersion;
    }
    // Beta 基础号与 Main 不一致，说明已有新功能在 Beta 测试
    // 比较 main+label 和当前 beta 版本，取版本号高的

    if (semver.gt(targetBaseVersion, currentBetaBaseVersion)) {
      // main+label 版本更高，修改基础号并重置测试号
      const newBetaVersion = `${targetBaseVersion}-beta.0`;
      logger.info(
        `🔼 目标版本高于当前 Beta 基础版本 (${targetBaseVersion} > ${currentBetaBaseVersion})，重置版本线: ${newBetaVersion}`,
      );
      return newBetaVersion;
    }
    // main+label 版本不高于当前 beta，增加测试号计数
    if (!currentBetaVersion) {
      throw new Error('无法增加测试号：当前 Beta 版本为空');
    }
    const incrementedVersion = semver.inc(currentBetaVersion, 'prerelease', 'beta');
    logger.info(
      `🔄 目标版本不高于当前 Beta 基础版本 (${targetBaseVersion} <= ${currentBetaBaseVersion})，递增测试号: ${incrementedVersion}`,
    );
    return incrementedVersion || currentBetaVersion;
  }

  canHandle(context: VersionUpgradeContext): boolean {
    return context.targetBranch === 'beta';
  }

  async execute(context: VersionUpgradeContext): Promise<string | null> {
    const { pr } = context;

    // 检查 PR 标签
    if (!pr?.labels || pr.labels.length === 0) {
      logger.info('📛 Beta 分支无 PR 标签，跳过版本升级');
      return null;
    }

    // 从 PR 标签获取发布类型
    const releaseType = getReleaseTypeFromLabels(pr.labels);
    if (!releaseType) {
      const allLabelNames = pr.labels.map((label) => label.name).join(', ');
      logger.info(`📝 PR #${pr.number} 有标签但无版本标签: [${allLabelNames}]，跳过版本升级`);
      return null;
    }

    logger.info(`✅ 使用 PR 标签: ${releaseType} (来源: PR #${pr.number})`);
    return await this.calculateBetaVersion(context, releaseType);
  }
}

/**
 * Main 分支策略 - 接受 Beta（正常发布）或 Hotfix（紧急修复）
 */
class MainStrategy implements VersionUpgradeStrategy {
  description = 'Main 分支接受 Beta（正常发布）或 Hotfix（紧急修复）';

  canHandle(context: VersionUpgradeContext): boolean {
    return context.targetBranch === 'main';
  }

  async execute(context: VersionUpgradeContext): Promise<string | null> {
    const { baseVersion, sourceBranch, pr } = context;

    // 场景 1: 来自 Beta - 正常发布流程
    if (sourceBranch === 'beta') {
      const betaBaseVersion = getBaseVersionString(baseVersion);
      logger.info(`🚀 从 Beta 转换为正式版: ${baseVersion} -> ${betaBaseVersion}`);
      return betaBaseVersion;
    }

    // 场景 2: 来自 Hotfix - 紧急修复流程
    if (sourceBranch.startsWith('hotfix/')) {
      // 检查必须有 hotfix 标签
      const hasHotfixLabel = pr?.labels?.some((label) => label.name.toLowerCase() === 'hotfix');
      if (!hasHotfixLabel) {
        const errorMsg = 'Hotfix 分支必须添加 "hotfix" 标签才能合并到 Main 分支';
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // 检查必须有版本标签
      if (!pr?.labels || pr.labels.length === 0) {
        const errorMsg = 'Hotfix 分支必须添加版本标签（major/minor/patch）';
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const releaseType = getReleaseTypeFromLabels(pr.labels);
      if (!releaseType) {
        const allLabelNames = pr.labels.map((label) => label.name).join(', ');
        const errorMsg = `Hotfix PR 有标签但缺少版本标签（major/minor/patch），当前标签: [${allLabelNames}]`;
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // 根据标签类型递增版本
      const releaseTypeMapping: Record<string, ReleaseType> = {
        premajor: 'major',
        preminor: 'minor',
        prepatch: 'patch',
      };
      const baseReleaseType: ReleaseType = releaseTypeMapping[releaseType] || releaseType;
      const newVersion = semver.inc(baseVersion, baseReleaseType);

      if (!newVersion) {
        const errorMsg = `无法根据标签 ${releaseType} 计算 Hotfix 版本`;
        logger.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      logger.info(`🔥 Hotfix 紧急修复: ${baseVersion} + ${releaseType} -> ${newVersion}`);
      return newVersion;
    }

    // 场景 3: 其他分支 - 不允许
    const errorMsg = `Main 分支只接受来自 Beta 或 Hotfix 分支的合并，当前源分支: ${sourceBranch}`;
    logger.error(`❌ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * 版本升级策略管理器
 */
class VersionUpgradeManager {
  private readonly strategies: VersionUpgradeStrategy[] = [new BetaStrategy(), new MainStrategy()];

  /**
   * 执行版本升级
   */
  async upgrade(context: VersionUpgradeContext): Promise<string | null> {
    for (let i = 0; i < this.strategies.length; i++) {
      const strategy = this.strategies[i];
      if (strategy.canHandle(context)) {
        logger.info(`📋 使用策略: ${strategy.description}`);

        // 统一执行分支状态验证
        await validateBranchVersionState(context.targetBranch, context.pr);

        const result = strategy.execute(context);
        return await Promise.resolve(result);
      }
    }

    logger.error('❌ 未找到适用的版本升级策略');
    return null;
  }

  /**
   * 获取所有策略的描述（用于调试）
   */
  getStrategiesDescription(): string[] {
    return this.strategies.map((strategy) => strategy.description);
  }
}

// 全局策略管理器实例
const upgradeManager = new VersionUpgradeManager();

// ==================== 版本升级逻辑 ====================

/**
 * 获取 Beta 分支基础版本
 */
async function getBetaBaseVersion(sourceBranch: string, pr: PRData | null): Promise<string | null> {
  // Beta 分支：不接受来自 Main 的合并
  if (sourceBranch === 'main') {
    const errorMsg = 'Beta 分支不接受来自 Main 分支的合并，Beta 分支只能用于新功能开发';
    logger.error(`❌ ${errorMsg}`);
    await throwErrorWithComment(errorMsg, 'getBaseVersion-beta', pr);
  }

  const currentBetaVersion = await versionManager.getLatestVersion('beta');
  const mainVersion = await versionManager.getLatestVersion('main');
  const mainBaseVersion = mainVersion ? getBaseVersionString(mainVersion) : '0.0.0';

  if (!currentBetaVersion) {
    // 没有 Beta 版本，基于 Main 分支版本开始
    const baseVersion = mainVersion || createDefaultVersion('BASE');
    logger.info(`📌 Beta 分支基础版本: ${baseVersion} (无 Beta 版本，基于 Main 版本)`);
    return baseVersion;
  }

  // 比较 Beta 基础号和 Main 版本
  const betaBaseVersion = getBaseVersionString(currentBetaVersion);

  if (betaBaseVersion === mainBaseVersion) {
    // Beta 基础号与 Main 一致，说明是新功能要进入 Beta 测试
    logger.info(
      `📌 Beta 分支基础版本: ${mainVersion || createDefaultVersion('BASE')} (Beta 基础号与 Main 一致，准备新功能测试)`,
    );
    return mainVersion || createDefaultVersion('BASE');
  }
  // Beta 基础号与 Main 不一致，说明已有新功能在 Beta 测试
  logger.info(`📌 Beta 分支基础版本: ${currentBetaVersion} (Beta 基础号与 Main 不一致，已有功能在测试)`);
  return currentBetaVersion;
}

/**
 * 获取 Main 分支基础版本
 */
async function getMainBaseVersion(sourceBranch: string, pr: PRData | null): Promise<string | null> {
  // 场景 1: 来自 Beta - 正常发布流程
  if (sourceBranch === 'beta') {
    const betaVersion = await versionManager.getLatestVersion('beta');
    if (!betaVersion) {
      const errorMsg = 'Main 分支发布失败：没有可用的 Beta 版本。Main 分支只能用于发布已完成测试的 Beta 版本';
      logger.error(`❌ ${errorMsg}`);
      await throwErrorWithComment(errorMsg, 'getBaseVersion-main', pr);
    }
    logger.info(`📌 Main 分支基础版本: ${betaVersion} (来自 Beta，正常发布)`);
    return betaVersion;
  }

  // 场景 2: 来自 Hotfix - 紧急修复流程
  if (sourceBranch.startsWith('hotfix/')) {
    const mainVersion = await versionManager.getLatestVersion('main');
    if (!mainVersion) {
      const errorMsg = 'Hotfix 失败：Main 分支没有版本，无法进行紧急修复';
      logger.error(`❌ ${errorMsg}`);
      await throwErrorWithComment(errorMsg, 'getBaseVersion-main', pr);
    }
    logger.info(`📌 Main 分支基础版本: ${mainVersion} (来自 Hotfix，紧急修复)`);
    return mainVersion;
  }

  // 场景 3: 其他分支 - 不允许
  const errorMsg = `Main 分支只接受来自 Beta 或 Hotfix 分支的合并，当前源分支: ${sourceBranch}`;
  logger.error(`❌ ${errorMsg}`);
  await throwErrorWithComment(errorMsg, 'getBaseVersion-main', pr);
  return null; // throwErrorWithComment 会抛出错误，这里不会执行到
}

/**
 * 获取目标分支的基础版本 - 基于源分支和目标分支的完整判断逻辑
 */
export async function getBaseVersion(
  targetBranch: SupportedBranch,
  sourceBranch: string,
  pr: PRData | null = null,
): Promise<string | null> {
  switch (targetBranch) {
    case 'beta':
      return getBetaBaseVersion(sourceBranch, pr);
    case 'main':
      return getMainBaseVersion(sourceBranch, pr);
    default:
      return null;
  }
}

/**
 * 统一的版本升级计算逻辑 - 使用策略模式
 */
async function calculateVersionUpgrade(
  baseVersion: string,
  targetBranch: SupportedBranch,
  sourceBranch: string,
  pr: PRData | null,
): Promise<string | null> {
  // 创建升级上下文
  const context = createUpgradeContext(baseVersion, targetBranch, sourceBranch, pr);
  if (!context) {
    logger.error(`无法解析基础版本: ${baseVersion}`);
    return null;
  }

  // 使用策略管理器执行升级
  const newVersion = await upgradeManager.upgrade(context);
  return newVersion ? addVersionPrefix(newVersion) : null;
}

/**
 * 计算新版本号 - 统一版本升级逻辑
 */
export async function calculateNewVersion(
  targetBranch: SupportedBranch,
  sourceBranch: string,
  pr: PRData | null,
): Promise<string | null> {
  try {
    // 获取上游分支的版本作为基础版本
    const baseVersion = await getBaseVersion(targetBranch, sourceBranch, pr);
    if (!baseVersion) {
      logger.error(`❌ 无法获取 ${targetBranch} 分支的基础版本`);
      return null;
    }

    logger.info(`📌 ${targetBranch} 分支基础版本: ${baseVersion}`);

    // 统一的版本升级逻辑
    const result = await calculateVersionUpgrade(baseVersion, targetBranch, sourceBranch, pr);

    if (result) {
      logger.info(`🎯 计算出新版本: ${result}`);
    } else {
      logger.info('⏭️ 无需版本升级');
    }

    return result;
  } catch (error) {
    throw new ActionError(`版本计算失败: ${error}`, 'calculateNewVersion', error);
  }
}

// ==================== 版本文件操作 ====================

/**
 * 安全地更新版本文件
 */
export async function updatePackageVersion(version: string): Promise<void> {
  try {
    const packageVersion = cleanVersion(version);
    const pkgPath = await resolvePackageJSON();
    const pkgInfo = await readPackageJSON(pkgPath);
    pkgInfo.version = packageVersion;
    await writePackageJSON(pkgPath, pkgInfo);
    logger.info(`版本文件已更新到: ${packageVersion}`);
  } catch (error) {
    throw new ActionError(`更新版本文件失败: ${error}`, 'updatePackageVersion', error);
  }
}

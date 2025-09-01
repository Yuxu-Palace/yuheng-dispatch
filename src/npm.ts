import { getInput, setOutput } from '@actions/core';
import { exec } from '@actions/exec';
import { logger } from './core';
import type { SupportedBranch } from './types';
import { ActionError, cleanVersion } from './utils';
import { parseVersion } from './version';

// ==================== NPM 发布功能 ====================

/**
 * 检查是否启用npm发布
 */
function isNpmPublishEnabled(): boolean {
  const enablePublish = getInput('enable-npm-publish')?.toLowerCase();
  return enablePublish === 'true';
}

/**
 * 获取npm发布配置
 */
function getNpmPublishConfig() {
  const registry = getInput('npm-registry') || 'https://registry.npmjs.org/';
  const token = getInput('npm-token');
  const tag = getInput('npm-tag') || 'latest';
  const access = getInput('npm-access') || 'public';

  return { registry, token, tag, access };
}

/**
 * 配置npm认证
 */
async function configureNpmAuth(registry: string, token: string): Promise<void> {
  try {
    // 设置registry
    await exec('npm', ['config', 'set', 'registry', registry]);
    logger.info(`配置npm registry: ${registry}`);

    // 设置认证token
    if (token) {
      const registryUrl = new URL(registry);
      const authKey = `//${registryUrl.host}/:_authToken`;
      await exec('npm', ['config', 'set', authKey, token]);
      logger.info('配置npm认证token');
    }
  } catch (error) {
    throw new ActionError(`配置npm认证失败: ${error}`, 'configureNpmAuth', error);
  }
}

/**
 * 确定npm发布标签
 */
function determineNpmTag(version: string, targetBranch: SupportedBranch, configTag: string): string {
  // 如果用户指定了特定标签，使用用户指定的标签
  if (configTag !== 'latest') {
    return configTag;
  }

  // 根据分支和版本自动确定标签
  if (targetBranch === 'main') {
    // 主分支使用latest标签
    return 'latest';
  }
  if (targetBranch === 'beta') {
    // Beta分支使用beta标签
    return 'beta';
  }
  if (targetBranch === 'alpha') {
    // Alpha分支使用alpha标签
    return 'alpha';
  }

  // 如果是预发布版本，根据prerelease标识确定标签
  const cleanedVersion = cleanVersion(version);
  const parsed = parseVersion(cleanedVersion);
  if (parsed?.prerelease && parsed.prerelease.length > 0) {
    const prereleaseId = parsed.prerelease[0] as string;
    if (prereleaseId === 'alpha') {
      return 'alpha';
    }
    if (prereleaseId === 'beta') {
      return 'beta';
    }
  }

  return 'latest';
}

/**
 * 执行npm发布
 */
async function publishToNpm(
  version: string,
  targetBranch: SupportedBranch,
  config: { registry: string; token: string; tag: string; access: string },
): Promise<void> {
  try {
    // 确定发布标签
    const publishTag = determineNpmTag(version, targetBranch, config.tag);

    logger.info(`准备发布到npm: 版本=${version}, 标签=${publishTag}, 分支=${targetBranch}`);

    // 配置npm认证
    await configureNpmAuth(config.registry, config.token);

    // 构建发布命令
    const publishArgs = ['publish'];

    // 添加访问权限
    if (config.access) {
      publishArgs.push('--access', config.access);
    }

    // 添加标签
    publishArgs.push('--tag', publishTag);

    // 执行发布
    await exec('npm', publishArgs);

    logger.info(`✅ 成功发布到npm: ${version} (标签: ${publishTag})`);

    // 设置输出
    setOutput('published-version', version);
    setOutput('published-tag', publishTag);
    setOutput('npm-registry', config.registry);
  } catch (error) {
    // 检查是否是版本已存在的错误
    const errorMessage = String(error);
    if (
      errorMessage.includes('version already exists') ||
      errorMessage.includes('You cannot publish over the previously published versions')
    ) {
      logger.warning(`版本 ${version} 已存在于npm registry，跳过发布`);
      return;
    }

    throw new ActionError(`npm发布失败: ${error}`, 'publishToNpm', error);
  }
}

/**
 * 处理npm发布逻辑 - 只对目标分支版本发布
 */
export async function handleNpmPublish(version: string, targetBranch: SupportedBranch): Promise<void> {
  if (!isNpmPublishEnabled()) {
    logger.info('npm发布已禁用，跳过');
    return;
  }

  try {
    logger.info(`开始npm发布流程: 版本=${version}, 目标分支=${targetBranch}`);

    const config = getNpmPublishConfig();

    // 验证必需的配置
    if (!config.token) {
      throw new ActionError('npm-token未配置，无法发布到npm', 'handleNpmPublish');
    }

    // 只对目标分支的版本进行发布，不处理下游分支
    await publishToNpm(version, targetBranch, config);

    logger.info(`✅ ${targetBranch}分支版本 ${version} npm发布完成`);
  } catch (error) {
    // npm发布失败不应该中断整个流程
    logger.error(`npm发布失败: ${error}`);
    setOutput('npm-publish-failed', 'true');
    setOutput('npm-publish-error', String(error));

    // 如果用户要求严格模式，则抛出错误
    const strictMode = getInput('npm-publish-strict')?.toLowerCase() === 'true';
    if (strictMode) {
      throw error;
    }
  }
}

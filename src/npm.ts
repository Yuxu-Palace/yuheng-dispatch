import process from 'node:process';
import { exec, getExecOutput } from '@actions/exec';
import { getBooleanInput, getInput, logger, setOutput } from './core';
import type { SupportedBranch } from './types';
import { ActionError, cleanVersion } from './utils';
import { parseVersion } from './version';

// ==================== NPM 发布功能 ====================

/**
 * 检查是否启用 npm 发布
 */
function isNpmPublishEnabled(): boolean {
  return getBooleanInput('enable-npm-publish');
}

/**
 * 获取 npm 发布配置
 */
function getNpmPublishConfig() {
  const registry = getInput('npm-registry') || 'https://registry.npmjs.org/';
  const token = getInput('npm-token');
  const tag = (getInput('npm-tag') || 'auto').toLowerCase();
  const access = getInput('npm-access') || 'public';

  return { registry, token, tag, access };
}

/**
 * 验证 npm 认证是否有效（预检查）
 */
async function verifyNpmAuth(registry: string, token: string): Promise<void> {
  try {
    logger.info('预检查 npm 认证...');

    // 临时配置认证
    await configureNpmAuth(registry, token);

    // 验证认证是否有效
    try {
      await exec('npm', ['whoami', '--registry', registry], {
        env: { ...process.env, NODE_AUTH_TOKEN: token || '' },
      });
      logger.info('✅ npm 认证验证成功');
    } catch (whoamiError) {
      throw new ActionError(`npm 认证无效，无法执行 whoami 命令: ${whoamiError}`, 'verifyNpmAuth', whoamiError);
    }
  } catch (error) {
    throw new ActionError(`npm 认证预检查失败: ${error}`, 'verifyNpmAuth', error);
  }
}

/**
 * 配置 npm 认证
 */
async function configureNpmAuth(registry: string, token: string): Promise<void> {
  try {
    let npmMajorVersion: number | null = null;
    try {
      const { stdout } = await getExecOutput('npm', ['--version'], { silent: true });
      const version = stdout.trim();
      const majorPart = Number.parseInt(version.split('.')[0] ?? '', 10);
      if (!Number.isNaN(majorPart)) {
        npmMajorVersion = majorPart;
      }
    } catch (detectError) {
      logger.debug(`跳过 npm 版本检测: ${detectError}`);
    }

    // 设置 registry
    await exec('npm', ['config', 'set', 'registry', registry]);
    logger.info(`配置 npm registry: ${registry}`);

    // 设置认证 token
    if (token) {
      const registryUrl = new URL(registry);
      // 确保带上 pathname 且以 / 结尾，兼容带路径的 registry
      const pathname = registryUrl.pathname.endsWith('/') ? registryUrl.pathname : `${registryUrl.pathname}/`;
      const scopedKey = `//${registryUrl.host}${pathname}`;
      await exec('npm', ['config', 'set', `${scopedKey}:_authToken`, token]);
      const shouldConfigureAlwaysAuth = npmMajorVersion === null || npmMajorVersion < 10;
      if (shouldConfigureAlwaysAuth) {
        try {
          await exec('npm', ['config', 'set', `${scopedKey}:always-auth`, 'true']);
        } catch (alwaysAuthError) {
          logger.warning(`配置 always-auth 失败，已忽略: ${alwaysAuthError}`);
        }
      } else {
        logger.debug('检测到 npm >= 10，无需配置 always-auth');
      }
      logger.info('配置 npm 认证 token');
    }
  } catch (error) {
    throw new ActionError(`配置 npm 认证失败: ${error}`, 'configureNpmAuth', error);
  }
}

/**
 * 确定 npm 发布标签
 */
function determineNpmTag(version: string, targetBranch: SupportedBranch, configTag: string): string {
  // 如果用户指定了特定标签，使用用户指定的标签
  if (configTag !== 'auto') {
    return configTag;
  }

  // 根据分支和版本自动确定标签
  if (targetBranch === 'main') {
    // 主分支使用 latest 标签
    return 'latest';
  }
  if (targetBranch === 'beta') {
    // Beta 分支使用 beta 标签
    return 'beta';
  }
  if (targetBranch === 'alpha') {
    // Alpha 分支使用 alpha 标签
    return 'alpha';
  }

  // 如果是预发布版本，根据 prerelease 标识确定标签
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
 * 执行 npm 发布
 */
async function publishToNpm(
  version: string,
  targetBranch: SupportedBranch,
  config: { registry: string; token: string; tag: string; access: string },
): Promise<void> {
  try {
    // 确定发布标签
    const publishTag = determineNpmTag(version, targetBranch, config.tag);

    logger.info(`准备发布到 npm: 版本=${version}, 标签=${publishTag}, 分支=${targetBranch}`);

    // 配置 npm 认证
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
    await exec('npm', publishArgs, {
      env: { ...process.env, NODE_AUTH_TOKEN: config.token || '' },
    });

    logger.info(`✅ 成功发布到 npm: ${version} (标签: ${publishTag})`);

    // 设置输出
    setOutput('published-version', version);
    setOutput('published-tag', publishTag);
    setOutput('npm-registry', config.registry);
  } catch (error) {
    // 检查是否是版本已存在的错误
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      /version already exists/i.test(errorMessage) ||
      /previously published versions/i.test(errorMessage) ||
      /EPUBLISHCONFLICT/i.test(errorMessage) ||
      /\bE403\b/.test(errorMessage)
    ) {
      logger.warning(`版本 ${version} 已存在于 npm registry，跳过发布`);
      return;
    }

    throw new ActionError(`npm 发布失败: ${error}`, 'publishToNpm', error);
  }
}

/**
 * 预检查 npm 认证配置（导出供 git.ts 使用）
 */
export async function verifyNpmPublishConfig(): Promise<void> {
  if (!isNpmPublishEnabled()) {
    return; // 未启用发布，跳过检查
  }

  const config = getNpmPublishConfig();

  // 验证必需的配置
  if (!config.token) {
    throw new ActionError('npm-token 未配置，无法发布到 npm', 'verifyNpmPublishConfig');
  }

  // 预检查认证
  await verifyNpmAuth(config.registry, config.token);
}

/**
 * 处理 npm 发布逻辑 - 只对目标分支版本发布
 */
export async function handleNpmPublish(version: string, targetBranch: SupportedBranch): Promise<boolean> {
  if (!isNpmPublishEnabled()) {
    logger.info('npm 发布已禁用，跳过');
    return true;
  }

  try {
    logger.info(`开始 npm 发布流程: 版本=${version}, 目标分支=${targetBranch}`);

    const config = getNpmPublishConfig();

    // 验证必需的配置
    if (!config.token) {
      throw new ActionError('npm-token 未配置，无法发布到 npm', 'handleNpmPublish');
    }

    // 只对目标分支的版本进行发布，不处理下游分支
    await publishToNpm(version, targetBranch, config);

    logger.info(`✅ ${targetBranch}分支版本 ${version} npm 发布完成`);
    return true;
  } catch (error) {
    // 记录详细的错误信息
    logger.error(`❌ npm 发布失败: ${error}`);
    setOutput('npm-publish-failed', 'true');
    setOutput('npm-publish-error', String(error));

    // 如果用户要求严格模式，则抛出错误
    const strictMode = getInput('npm-publish-strict')?.toLowerCase() === 'true';
    if (strictMode) {
      logger.error('npm-publish-strict 模式已启用，发布失败将中断工作流');
      throw error;
    }

    // 非严格模式：记录警告但不中断流程
    logger.warning('⚠️  npm 发布失败，但非严格模式允许继续。建议：');
    logger.warning('   1. 检查错误日志，修复问题');
    logger.warning('   2. 使用已创建的 Git tag 手动重新发布');
    logger.warning('   3. 或者合并下一个 PR 触发新版本发布');

    return false;
  }
}

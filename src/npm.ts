import process from 'node:process';
import type { ExecOptions } from '@actions/exec';
import { exec, getExecOutput } from '@actions/exec';
import { getBooleanInput, getInput, logger, setOutput } from './core';
import type { SupportedBranch } from './types';
import { ActionError, cleanVersion } from './utils';
import { parseVersion } from './version';

const NPM_VERSION_THRESHOLD_FOR_ALWAYS_AUTH = 10;
const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org/';
const DEFAULT_NPM_ACCESS = 'public';
const AUTO_TAG = 'auto';

const NPM_PUBLISH_ERROR_PATTERNS = [
  /version already exists/i,
  /previously published versions/i,
  /EPUBLISHCONFLICT/i,
  /\bE403\b/,
] as const;

async function execNpm(args: string[], options: ExecOptions = {}): Promise<void> {
  const execOptions: ExecOptions = {
    ...options,
    silent: options.silent ?? true,
  };

  await exec('npm', args, execOptions);
}

interface NpmPublishConfig {
  registry: string;
  token: string;
  tag: string;
  access: string;
}

function isNpmPublishEnabled(): boolean {
  return getBooleanInput('enable-npm-publish');
}

function getNpmPublishConfig(): NpmPublishConfig {
  return {
    registry: getInput('npm-registry') || DEFAULT_NPM_REGISTRY,
    token: getInput('npm-token'),
    tag: (getInput('npm-tag') || AUTO_TAG).toLowerCase(),
    access: getInput('npm-access') || DEFAULT_NPM_ACCESS,
  };
}

function validateNpmToken(token: string): void {
  if (!token) {
    throw new ActionError('npm-token 未配置，无法发布到 npm', 'validateNpmToken');
  }
}

async function verifyNpmAuth(registry: string, token: string): Promise<void> {
  logger.info('预检查 npm 认证...');

  await configureNpmAuth(registry, token);
  await executeNpmWhoami(registry, token);

  logger.info('✅ npm 认证验证成功');
}

async function executeNpmWhoami(registry: string, token: string): Promise<void> {
  try {
    await execNpm(['whoami', '--registry', registry], {
      env: { ...process.env, NODE_AUTH_TOKEN: token || '' },
    });
  } catch (whoamiError) {
    throw new ActionError(`npm 认证无效，无法执行 whoami 命令: ${whoamiError}`, 'executeNpmWhoami', whoamiError);
  }
}

async function configureNpmAuth(registry: string, token: string): Promise<void> {
  try {
    await setNpmRegistry(registry);
    await configureNpmAuthToken(registry, token);
  } catch (error) {
    throw new ActionError(`配置 npm 认证失败: ${error}`, 'configureNpmAuth', error);
  }
}

async function setNpmRegistry(registry: string): Promise<void> {
  await execNpm(['config', 'set', 'registry', registry]);
  logger.info(`配置 npm registry: ${registry}`);
}

async function configureNpmAuthToken(registry: string, token: string): Promise<void> {
  if (!token) {
    return;
  }

  const scopedKey = buildRegistryScopedKey(registry);
  await setAuthToken(scopedKey, token);
  await configureAlwaysAuthIfNeeded(scopedKey);

  logger.info('配置 npm 认证 token');
}

function buildRegistryScopedKey(registry: string): string {
  const registryUrl = new URL(registry);
  const pathname = registryUrl.pathname.endsWith('/') ? registryUrl.pathname : `${registryUrl.pathname}/`;
  return `//${registryUrl.host}${pathname}`;
}

async function setAuthToken(scopedKey: string, token: string): Promise<void> {
  await execNpm(['config', 'set', `${scopedKey}:_authToken`, token]);
}

async function configureAlwaysAuthIfNeeded(scopedKey: string): Promise<void> {
  const npmMajorVersion = await detectNpmMajorVersion();

  if (shouldConfigureAlwaysAuth(npmMajorVersion)) {
    await trySetAlwaysAuth(scopedKey);
  } else {
    logger.debug('检测到 npm >= 10，无需配置 always-auth');
  }
}

function shouldConfigureAlwaysAuth(npmMajorVersion: number | null): boolean {
  return npmMajorVersion === null || npmMajorVersion < NPM_VERSION_THRESHOLD_FOR_ALWAYS_AUTH;
}

async function trySetAlwaysAuth(scopedKey: string): Promise<void> {
  try {
    await execNpm(['config', 'set', `${scopedKey}:always-auth`, 'true']);
  } catch (alwaysAuthError) {
    logger.warning(`配置 always-auth 失败，已忽略: ${alwaysAuthError}`);
  }
}

async function detectNpmMajorVersion(): Promise<number | null> {
  try {
    const { stdout } = await getExecOutput('npm', ['--version'], { silent: true });
    const versionString = stdout.trim();
    return parseNpmMajorVersion(versionString);
  } catch (error) {
    logger.debug(`跳过 npm 版本检测: ${error}`);
    return null;
  }
}

function parseNpmMajorVersion(versionString: string): number | null {
  const majorPart = Number.parseInt(versionString.split('.')[0] ?? '', 10);
  return Number.isNaN(majorPart) ? null : majorPart;
}

function determineNpmTag(version: string, targetBranch: SupportedBranch, configTag: string): string {
  if (isUserSpecifiedTag(configTag)) {
    return configTag;
  }

  return determineAutoTag(version, targetBranch);
}

function isUserSpecifiedTag(configTag: string): boolean {
  return configTag !== AUTO_TAG;
}

function determineAutoTag(version: string, targetBranch: SupportedBranch): string {
  const tagFromBranch = getTagFromBranch(targetBranch);
  if (tagFromBranch) {
    return tagFromBranch;
  }

  return getTagFromPrereleaseVersion(version);
}

function getTagFromBranch(branch: SupportedBranch): string | null {
  const branchTagMap: Record<SupportedBranch, string> = {
    main: 'latest',
    beta: 'beta',
    alpha: 'alpha',
  };

  return branchTagMap[branch] || null;
}

function getTagFromPrereleaseVersion(version: string): string {
  const cleanedVersion = cleanVersion(version);
  const parsed = parseVersion(cleanedVersion);

  if (parsed?.prerelease && parsed.prerelease.length > 0) {
    const prereleaseId = String(parsed.prerelease[0]);
    if (prereleaseId === 'alpha' || prereleaseId === 'beta') {
      return prereleaseId;
    }
  }

  return 'latest';
}

async function publishToNpm(version: string, targetBranch: SupportedBranch, config: NpmPublishConfig): Promise<void> {
  const publishTag = determineNpmTag(version, targetBranch, config.tag);
  logger.info(`准备发布到 npm: 版本=${version}, 标签=${publishTag}, 分支=${targetBranch}`);

  await configureNpmAuth(config.registry, config.token);

  try {
    await executeNpmPublish(config, publishTag);
    logPublishSuccess(version, publishTag);
    setPublishOutputs(version, publishTag, config.registry);
  } catch (error) {
    handlePublishError(error, version);
  }
}

async function executeNpmPublish(config: NpmPublishConfig, publishTag: string): Promise<void> {
  const publishArgs = buildPublishArgs(config.access, publishTag);

  await execNpm(publishArgs, {
    env: { ...process.env, NODE_AUTH_TOKEN: config.token || '' },
  });
}

function buildPublishArgs(access: string, publishTag: string): string[] {
  const args = ['publish'];

  if (access) {
    args.push('--access', access);
  }

  args.push('--tag', publishTag);

  return args;
}

function logPublishSuccess(version: string, publishTag: string): void {
  logger.info(`✅ 成功发布到 npm: ${version} (标签: ${publishTag})`);
}

function setPublishOutputs(version: string, publishTag: string, registry: string): void {
  setOutput('published-version', version);
  setOutput('published-tag', publishTag);
  setOutput('npm-registry', registry);
}

function handlePublishError(error: unknown, version: string): void {
  if (isVersionAlreadyExistsError(error)) {
    logger.warning(`版本 ${version} 已存在于 npm registry，跳过发布`);
    return;
  }

  throw new ActionError(`npm 发布失败: ${error}`, 'publishToNpm', error);
}

function isVersionAlreadyExistsError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return NPM_PUBLISH_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

export async function verifyNpmPublishConfig(): Promise<void> {
  if (!isNpmPublishEnabled()) {
    return;
  }

  const config = getNpmPublishConfig();
  validateNpmToken(config.token);
  await verifyNpmAuth(config.registry, config.token);
}

export async function handleNpmPublish(version: string, targetBranch: SupportedBranch): Promise<boolean> {
  if (!isNpmPublishEnabled()) {
    logger.info('npm 发布已禁用，跳过');
    return true;
  }

  logger.info(`开始 npm 发布流程: 版本=${version}, 目标分支=${targetBranch}`);

  const config = getNpmPublishConfig();
  validateNpmToken(config.token);

  try {
    await publishToNpm(version, targetBranch, config);
    logger.info(`✅ ${targetBranch}分支版本 ${version} npm 发布完成`);
    return true;
  } catch (error) {
    return handleNpmPublishFailure(error);
  }
}

function handleNpmPublishFailure(error: unknown): boolean {
  logger.error(`❌ npm 发布失败: ${error}`);
  setPublishFailureOutputs(error);

  if (isStrictModeEnabled()) {
    logger.error('npm-publish-strict 模式已启用，发布失败将中断工作流');
    throw error;
  }

  logNonStrictModeWarnings();
  return false;
}

function setPublishFailureOutputs(error: unknown): void {
  setOutput('npm-publish-failed', 'true');
  setOutput('npm-publish-error', String(error));
}

function isStrictModeEnabled(): boolean {
  return getInput('npm-publish-strict')?.toLowerCase() === 'true';
}

function logNonStrictModeWarnings(): void {
  logger.warning('⚠️  npm 发布失败，但非严格模式允许继续。建议：');
  logger.warning('   1. 检查错误日志，修复问题');
  logger.warning('   2. 行为已回滚，可修复问题后重新触发自动发布流程');
  logger.warning('   3. 如需立即发布，可在本地验证后手动执行 npm publish');
}

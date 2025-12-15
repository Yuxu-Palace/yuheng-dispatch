import * as fs from 'node:fs';
import type { ExecOptions } from '@actions/exec';
import { exec } from '@actions/exec';
import { logger } from './core';

/** pkg.pr.new 发布结果 */
export interface PkgPrNewResult {
  success: boolean;
  url?: string;
  packages?: Array<{ name: string; url: string }>;
  error?: string;
}

interface PkgPrNewOutput {
  packages?: Array<{
    name: string;
    url: string;
  }>;
  templates?: Array<{
    name: string;
    url: string;
  }>;
}

/**
 * 执行 pkg.pr.new 发布
 * @param version 版本号（仅用于日志展示）
 * @param enablePkgPrNew 是否启用预览包发布
 */
export async function publishToPkgPrNew(version: string, enablePkgPrNew = false): Promise<PkgPrNewResult> {
  if (!enablePkgPrNew) {
    logger.info('pkg.pr.new 功能未启用，跳过发布');
    return { success: false };
  }

  logger.info(`🚀 开始发布 pkg.pr.new 预览包 (版本: ${version})...`);

  const outputFile = '/tmp/pkg-pr-new-output.json';

  try {
    let stdout = '';
    let stderr = '';

    const execOptions: ExecOptions = {
      listeners: {
        stdout: (data: Buffer) => {
          stdout += data.toString();
        },
        stderr: (data: Buffer) => {
          stderr += data.toString();
        },
      },
      // GitHub Actions 默认有 Job 超时控制，这里不额外设置 timeout 以避免类型不兼容
    };

    await exec('pnpm', ['dlx', 'pkg-pr-new', 'publish', '--json', outputFile, '--comment=off'], execOptions);

    if (stdout) {
      logger.debug(`pkg.pr.new stdout: ${stdout}`);
    }
    if (stderr) {
      logger.debug(`pkg.pr.new stderr: ${stderr}`);
    }

    if (!fs.existsSync(outputFile)) {
      throw new Error('pkg.pr.new 未生成输出文件');
    }

    const outputContent = fs.readFileSync(outputFile, 'utf-8');
    const output: PkgPrNewOutput = JSON.parse(outputContent);

    const firstPackage = output.packages?.[0];
    const url = firstPackage?.url;

    if (!url) {
      throw new Error('pkg.pr.new 输出中未找到预览包 URL');
    }

    logger.info(`✅ pkg.pr.new 发布成功: ${url}`);

    try {
      fs.unlinkSync(outputFile);
    } catch (cleanupError) {
      logger.warning(`清理临时文件失败: ${cleanupError}`);
    }

    return {
      success: true,
      url,
      packages: output.packages || [],
    };
  } catch (error) {
    const errorMsg = `pkg.pr.new 发布失败: ${error}`;
    logger.warning(errorMsg);

    try {
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }
    } catch (cleanupError) {
      logger.warning(`清理临时文件失败: ${cleanupError}`);
    }

    return {
      success: false,
      error: errorMsg,
    };
  }
}

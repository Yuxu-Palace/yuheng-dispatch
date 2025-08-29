import { exec } from '@actions/exec';
import { COMMIT_TEMPLATES, LABEL_TO_CHANGELOG_TYPE } from './constants';
import { getInput, logger } from './core';
import type { PRData } from './types';
import { addVersionPrefix, commitAndPushFile, hasFileChanges } from './utils';

// ==================== CHANGELOG 操作 ====================

/**
 * 从PR标签推断变更类型
 */
function getChangeTypeFromLabels(labels: { name: string }[] | undefined): string {
  if (!labels) {
    return '📝 Changes';
  }

  // 优先查找特定标签类型
  for (const label of labels) {
    if (LABEL_TO_CHANGELOG_TYPE[label.name]) {
      return LABEL_TO_CHANGELOG_TYPE[label.name];
    }
  }

  // 基于版本标签推断
  const labelNames = labels.map((label) => label.name);
  if (labelNames.includes('major')) {
    return '💥 Breaking Changes';
  }
  if (labelNames.includes('minor')) {
    return '✨ Features';
  }
  if (labelNames.includes('patch')) {
    return '🐛 Bug Fixes';
  }

  return '📝 Changes';
}

/**
 * 从PR body中提取section内容
 */
function extractSectionFromBody(body: string): string {
  const sections = [
    '### Changes',
    '## Changes',
    "### What's Changed",
    "## What's Changed",
    '### Summary',
    '## Summary',
  ];

  for (const section of sections) {
    const sectionIndex = body.indexOf(section);
    if (sectionIndex !== -1) {
      const sectionContent = body.substring(sectionIndex + section.length);
      const nextSectionIndex = sectionContent.search(/^##/m);
      const content = nextSectionIndex !== -1 ? sectionContent.substring(0, nextSectionIndex) : sectionContent;

      const cleanContent = content
        .trim()
        .split('\\n')
        .filter((line) => line.trim())
        .slice(0, 5) // 最多5行
        .map((line) => (line.startsWith('- ') ? `  ${line}` : `  - ${line}`))
        .join('\\n');

      if (cleanContent) {
        return `${cleanContent}\\n`;
      }
    }
  }

  return '';
}

/**
 * 基于PR信息生成CHANGELOG条目
 */
async function generateChangelogFromPR(pr: PRData | null, version: string): Promise<string> {
  if (!pr) {
    return `### Changes\\n- Version ${version} release\\n`;
  }

  // 推断变更类型
  const changeType = getChangeTypeFromLabels(pr.labels);

  // 构建基础条目
  const prTitle = pr.title || `PR #${pr.number}`;
  const prUrl = pr.html_url;
  let changelogEntry = `### ${changeType}\\n`;
  changelogEntry += `- ${prTitle} ([#${pr.number}](${prUrl}))\\n`;

  // 添加PR body的相关内容
  if (pr.body && pr.body.trim()) {
    const bodyContent = extractSectionFromBody(pr.body.trim());
    changelogEntry += bodyContent;
  }

  return changelogEntry;
}

/**
 * 更新 CHANGELOG - 基于PR信息生成
 */
export async function updateChangelog(pr: PRData | null = null, version = ''): Promise<void> {
  // 检查是否启用CHANGELOG生成
  const enableChangelog = getInput('enable-changelog')?.toLowerCase() !== 'false';
  if (!enableChangelog) {
    logger.info('CHANGELOG 生成已禁用，跳过');
    return;
  }

  try {
    logger.info('开始生成基于PR的 CHANGELOG...');

    const currentDate = new Date().toISOString().split('T')[0];
    const versionTag = version.startsWith('v') ? version : `v${version}`;

    // 生成基于PR的CHANGELOG条目
    const changelogEntry = await generateChangelogFromPR(pr, version);

    const newEntry = `## [${versionTag}] - ${currentDate}

${changelogEntry}
`;

    // 读取现有CHANGELOG内容
    let existingContent = '';
    try {
      let stdout = '';
      await exec('cat', ['CHANGELOG.md'], {
        listeners: {
          stdout: (data: Buffer) => {
            stdout += data.toString();
          },
        },
      });
      existingContent = stdout;
      logger.info('读取现有CHANGELOG内容');
    } catch {
      // 如果文件不存在，创建初始内容
      existingContent = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`;
      logger.info('CHANGELOG.md 不存在，创建新文件');
    }

    // 插入新条目到第一个版本记录之前
    const lines = existingContent.split('\\n');
    let insertIndex = lines.length;

    // 查找第一个版本标题的位置
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^## \\[.*\\]/)) {
        insertIndex = i;
        break;
      }
    }

    // 插入新条目
    const entryLines = newEntry.split('\\n');
    lines.splice(insertIndex, 0, ...entryLines);

    // 写回文件
    const newContent = lines.join('\\n');
    await exec('sh', ['-c', `cat > CHANGELOG.md << 'EOF'\\n${newContent}\\nEOF`]);

    logger.info(`✅ CHANGELOG 已更新，添加版本 ${versionTag}`);

    // 显示新增的内容预览
    try {
      let stdout = '';
      await exec('head', ['-15', 'CHANGELOG.md'], {
        listeners: {
          stdout: (data: Buffer) => {
            stdout += data.toString();
          },
        },
      });
      logger.info('📋 CHANGELOG 预览:');
      logger.info(stdout);
    } catch {
      logger.info('无法显示CHANGELOG预览');
    }
  } catch (error) {
    logger.warning(`基于PR的CHANGELOG生成失败: ${error}`);

    // 如果失败，使用原来的conventional-changelog逻辑作为备用
    await fallbackToConventionalChangelog();
  }
}

/**
 * 备用方案：使用conventional-changelog
 */
async function fallbackToConventionalChangelog(): Promise<void> {
  try {
    logger.info('使用conventional-changelog作为备用方案...');

    // 检查是否已安装
    try {
      await exec('npx', ['conventional-changelog-cli', '--version']);
    } catch {
      await exec('npm', ['install', '-g', 'conventional-changelog-cli', 'conventional-changelog-conventionalcommits']);
    }

    await exec('npx', [
      'conventional-changelog-cli',
      '-p',
      'conventionalcommits',
      '-i',
      'CHANGELOG.md',
      '-s',
      '-r',
      '0',
    ]);

    logger.info('✅ 使用conventional-changelog生成完成');
  } catch (error) {
    logger.warning(`备用CHANGELOG生成也失败: ${error}`);
  }
}

/**
 * 检查CHANGELOG文件是否有变化
 */
export async function hasChangelogChanges(): Promise<boolean> {
  return await hasFileChanges('CHANGELOG.md');
}

/**
 * 提交CHANGELOG文件更改
 */
export async function commitChangelog(version: string, targetBranch: string): Promise<void> {
  const fullVersion = addVersionPrefix(version);
  await commitAndPushFile('CHANGELOG.md', COMMIT_TEMPLATES.CHANGELOG_UPDATE(fullVersion), targetBranch as any);
  logger.info('✅ CHANGELOG 更新已提交');
}

import { exec } from '@actions/exec';
import { COMMIT_TEMPLATES } from './constants';
import core, { logger } from './core';
import { ActionError, type PRData } from './types';
import { addVersionPrefix } from './version';

// ==================== CHANGELOG 操作 ====================

/**
 * 基于PR信息生成CHANGELOG条目
 */
async function generateChangelogFromPR(pr: PRData | null, version: string): Promise<string> {
  if (!pr) {
    return `### Changes\\n- Version ${version} release\\n`;
  }

  // PR标签到CHANGELOG类型的映射
  const labelToChangelogType: Record<string, string> = {
    major: '💥 Breaking Changes',
    minor: '✨ Features',
    patch: '🐛 Bug Fixes',
    enhancement: '⚡ Improvements',
    performance: '🚀 Performance',
    security: '🔒 Security',
    documentation: '📚 Documentation',
    dependencies: '⬆️ Dependencies',
  };

  // 从PR标签推断变更类型
  let changeType = '📝 Changes';
  if (pr.labels) {
    for (let i = 0; i < pr.labels.length; i++) {
      const label = pr.labels[i];
      if (labelToChangelogType[label.name]) {
        changeType = labelToChangelogType[label.name];
        break;
      }
    }

    // 如果没找到特定类型，基于版本标签推断
    if (changeType === '📝 Changes') {
      const versionLabels = pr.labels.map((l) => l.name);
      if (versionLabels.includes('major')) changeType = '💥 Breaking Changes';
      else if (versionLabels.includes('minor')) changeType = '✨ Features';
      else if (versionLabels.includes('patch')) changeType = '🐛 Bug Fixes';
    }
  }

  // 构建CHANGELOG条目
  let changelogEntry = `### ${changeType}\\n`;

  // 添加PR标题和链接
  const prUrl = pr.html_url;
  const prTitle = pr.title || `PR #${pr.number}`;
  changelogEntry += `- ${prTitle} ([#${pr.number}](${prUrl}))\\n`;

  // 如果PR有body，提取关键信息
  if (pr.body && pr.body.trim()) {
    const body = pr.body.trim();

    // 查找特定的section（如 "### Changes", "## What's Changed" 等）
    const sections = [
      '### Changes',
      '## Changes',
      "### What's Changed",
      "## What's Changed",
      '### Summary',
      '## Summary',
    ];
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
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
          changelogEntry += `${cleanContent}\\n`;
          break;
        }
      }
    }
  }

  return changelogEntry;
}

/**
 * 更新 CHANGELOG - 基于PR信息生成
 */
export async function updateChangelog(pr: PRData | null = null, version: string = ''): Promise<void> {
  // 检查是否启用CHANGELOG生成
  const enableChangelog = core.getInput('enable-changelog')?.toLowerCase() !== 'false';
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
  const { hasFileChanges } = await import('./git');
  return await hasFileChanges('CHANGELOG.md');
}

/**
 * 提交CHANGELOG文件更改
 */
export async function commitChangelog(version: string, targetBranch: string): Promise<void> {
  const { commitAndPushFile } = await import('./git');
  const fullVersion = addVersionPrefix(version);
  await commitAndPushFile('CHANGELOG.md', COMMIT_TEMPLATES.CHANGELOG_UPDATE(fullVersion), targetBranch as any);
  logger.info('✅ CHANGELOG 更新已提交');
}
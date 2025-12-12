# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a GitHub Action for automatic package version patching, designed to automatically increment package.json version numbers based on branch and PR labels in a semantic versioning workflow.

## Commands

### Build and Development
- `pnpm install` - Install dependencies
- `pnpm build` - Build the action using tsup (outputs to dist/index.cjs)
- `pnpm buildAndCommit` - Build the action and stage dist/ folder (used by husky pre-commit hook)

### Code Quality
- `pnpm check` - Run Biome linter and formatter with auto-fix
- `pnpm format` - Run Biome formatter only

### Git Hooks
- `pnpm prepare` - Set up husky git hooks
- Pre-commit hook runs `lint-staged` (formats TypeScript files) and `buildAndCommit` (builds and stages dist/)

## Architecture

### Core Components

**src/index.ts** - Main entry point orchestrating the GitHub Action workflow:
- Handles PR-based events only (preview for open PRs, execution for merged PRs)
- Uses modular architecture with separate validation, calculation, and execution phases
- Comprehensive error handling with PR comment feedback
- Manages Action outputs for integration with other workflows

**src/core.ts** - Simple wrapper around GitHub Actions core utilities providing a logger interface

**src/git.ts** - Git operations and branch synchronization logic:
- Git command execution utilities (`execGit`, `execGitWithOutput`)
- File change detection and commit/push operations  
- Branch synchronization with intelligent conflict resolution
- Automatic issue creation for unresolvable merge conflicts

**src/version.ts** - Version calculation and management:
- `VersionUtils` class with prefix handling, parsing, and normalization
- Git tag operations and version comparison logic
- Base version calculation from upstream branches
- Version upgrade algorithms based on labels and branch hierarchy
- Package.json version file updates

**src/pr.ts** - GitHub Pull Request operations:
- `PRUtils` class for PR label validation and release type detection
- PR information retrieval for pull_request events
- Comment management (create/update version previews, errors, skip messages)
- Event validation and branch support checking

**src/changelog.ts** - CHANGELOG generation and management:
- PR-based CHANGELOG entry generation with fallback to conventional-changelog
- Extracts relevant sections from PR bodies using pattern matching
- Handles CHANGELOG file updates with proper formatting and insertion
- Smart content processing (limits lines, formats consistently)

**src/utils.ts** - Utility functions and error handling:
- `ActionError` class for structured error reporting
- Version string manipulation and validation utilities
- Git operations helpers (commit, push, file change detection)
- Branch validation and type guards

**src/types.ts** - TypeScript type definitions:
- Core types: `SupportedBranch`, `VersionInfo`, `PRData`, `VersionPreviewData`, `PRWorkflowInfo`
- Structured interfaces for workflow state management
- Type guards and validation helpers

**src/constants.ts** - Configuration constants and templates:
- Version prefixes, Git user configuration, default values
- Message templates for commits, comments, and error reporting
- PR section patterns for CHANGELOG extraction
- Label-to-changelog-type mappings

### Version Management Strategy

The action implements a two-tier branching strategy:

1. **main branch** - Production releases (removes prerelease identifiers)
2. **beta branch** - Pre-release versions with `-beta` suffix

Version bumping behavior:
- Uses semver library for version calculations
- PR labels determine bump type: `major` → premajor, `minor` → preminor, `patch` → prepatch
- **Beta branch**: Adds `-beta` prerelease identifier, upgrades existing beta versions based on labels
- **Main branch**: Removes prerelease identifiers, creates production release
- Automatic branch synchronization: main → beta
- Complex conflict resolution: preserves higher version numbers during merges

### Workflow Execution Modes

**Preview Mode** (Open PRs):
- Triggered on PR open, sync, reopen, label changes
- Calculates potential version changes without executing
- Updates PR comments with version preview information
- Does not modify repository state

**Execution Mode** (Merged PRs):
- Triggered when PR is closed and merged
- Updates package.json version and creates git tags
- Generates/updates CHANGELOG.md based on PR information
- Synchronizes versions to downstream branches
- Handles merge conflicts with automatic issue creation

### Dependencies

Key external dependencies:
- `@actions/core`, `@actions/exec`, `@actions/github` - GitHub Actions runtime
- `semver` - Semantic version parsing and manipulation
- `pkg-types` - Package.json reading/writing utilities

Development dependencies:
- `@biomejs/biome` - Linting and formatting
- `tsup` - Build tool for bundling
- `husky` + `lint-staged` - Git hooks for code quality

### Build Configuration

- **tsup**: Bundles all dependencies into single CJS file at dist/index.cjs (configured via tsup.config.ts)
- **Biome**: Comprehensive linting and formatting rules configured in biome.json (120 char line width, single quotes, space indentation)
- **TypeScript**: ES modules with modern target (tsconfig.json)
- **Husky**: Pre-commit hooks ensure code quality and built artifacts are always up-to-date

### GitHub Action Configuration

Located in `action.yaml`:
- Requires `token` input (GitHub token for repository operations)
- Configurable version prefixes, git user info, and supported branches
- Runs on Node.js 20, executes built dist/index.cjs file

Workflow configuration in `.github/workflows/version-patch.yml`:
- Two-job setup: build validation + version management
- Conditional execution based on PR labels and merge status
- Artifact handling for built files

### Development Workflow

1. **File Changes**: Modify source files in `src/`
2. **Code Quality**: Pre-commit hooks automatically format and lint code
3. **Build**: Action is automatically built and dist/ is staged on commit
4. **Testing**: No automated test framework configured - test by creating PRs
5. **Branch Strategy**: Follow beta → main promotion workflow

ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
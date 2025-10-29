# Git Integration Best Practices for VS Code Extensions

Comprehensive research on integrating Git functionality into VS Code extensions, with specific focus on providing context for AI/LLM assistants.

**Research Date:** October 29, 2025
**Target Project:** ContextPack-Pro v0.0.6

---

## Table of Contents

1. [VS Code Git Extension API Best Practices](#1-vs-code-git-extension-api-best-practices)
2. [Git Context for LLM/AI Assistants](#2-git-context-for-llmai-assistants)
3. [User Experience Patterns](#3-user-experience-patterns)
4. [Security and Privacy](#4-security-and-privacy)
5. [Performance and Caching](#5-performance-and-caching)
6. [Anti-Patterns to Avoid](#6-anti-patterns-to-avoid)
7. [Implementation Examples](#7-implementation-examples)

---

## 1. VS Code Git Extension API Best Practices

### 1.1 Official API Documentation

**Primary Source:** https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts

The Git extension is bundled with VS Code and exposes an API for other extensions. It cannot be uninstalled, only disabled.

### 1.2 How to Access the Git API

**Step 1: Copy Type Definitions**
```bash
# Copy the git.d.ts file to your extension's source
curl -o src/git.d.ts https://raw.githubusercontent.com/microsoft/vscode/main/extensions/git/src/api/git.d.ts
```

**Step 2: Declare Extension Dependency**

This is **CRITICAL** to prevent race conditions. Add to your `package.json`:

```json
{
  "extensionDependencies": [
    "vscode.git"
  ]
}
```

**Step 3: Access the API with Proper Error Handling**

```typescript
import * as vscode from 'vscode';
import { GitExtension, API as GitAPI, Repository } from './git.d.ts';

async function getGitAPI(): Promise<GitAPI | undefined> {
  try {
    const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!extension) {
      return undefined;
    }

    // Activate the extension if it's not already active
    const gitExtension = extension.isActive
      ? extension.exports
      : await extension.activate();

    // Get API version 1
    return gitExtension.getAPI(1);
  } catch (error) {
    console.error('Failed to get Git API:', error);
    return undefined;
  }
}
```

### 1.3 Working with Repositories

**Key Insight:** The Git API uses an event-driven state model. Most methods like `repository.status()` return `void` and update the repository state asynchronously.

```typescript
async function setupGitListeners(api: GitAPI, context: vscode.ExtensionContext) {
  // Listen for new repositories being opened
  const repoDisposable = api.onDidOpenRepository(async (repo: Repository) => {
    console.log('Repository opened:', repo.rootUri.fsPath);

    // Access current state
    updateGitInfo(repo.state);

    // Listen for state changes on this specific repository
    const stateDisposable = repo.state.onDidChange(() => {
      updateGitInfo(repo.state);
    });

    // Register disposable for cleanup
    context.subscriptions.push(stateDisposable);
  });

  // Listen for repositories being closed
  const closeDisposable = api.onDidCloseRepository((repo: Repository) => {
    console.log('Repository closed:', repo.rootUri.fsPath);
  });

  // Register disposables for proper cleanup
  context.subscriptions.push(repoDisposable, closeDisposable);

  // Process existing repositories
  for (const repo of api.repositories) {
    updateGitInfo(repo.state);
  }
}

function updateGitInfo(state: any) {
  // Access repository state properties
  const branch = state.HEAD?.name;
  const commit = state.HEAD?.commit;
  const remotes = state.remotes;
  const workingTreeChanges = state.workingTreeChanges;
  const indexChanges = state.indexChanges;

  console.log('Current branch:', branch);
  console.log('Current commit:', commit);
  console.log('Modified files:', workingTreeChanges.length);
  console.log('Staged files:', indexChanges.length);
}
```

### 1.4 API Structure Overview

**Core Interfaces:**

- **API**: Entry point providing access to repositories
- **Repository**: Operations on a single repository (commit, branch, merge, push, pull, diff)
- **RepositoryState**: Current state (HEAD, branches, changes, remotes)
- **Ref**: References (HEAD, RemoteHead, Tag)
- **Branch**: Branch with upstream tracking information
- **Commit**: Commit details (hash, message, author, date)
- **Change**: File modification tracking
- **Remote**: Remote repository configuration

**Provider Patterns:**

Extensions can register providers to extend Git functionality:
- **CredentialsProvider**: Authentication
- **RemoteSourceProvider**: Repository discovery
- **PostCommitCommandsProvider**: Workflow automation
- **BranchProtectionProvider**: Policy enforcement

### 1.5 Error Handling

The Git API includes comprehensive error codes. Always handle these gracefully:

```typescript
import { GitErrorCodes } from './git.d.ts';

async function handleGitOperation(repo: Repository) {
  try {
    await repo.commit('My commit message');
  } catch (error: any) {
    if (error.gitErrorCode === GitErrorCodes.NoUserNameConfigured) {
      vscode.window.showErrorMessage(
        'Git user name is not configured. Please configure it before committing.'
      );
    } else if (error.gitErrorCode === GitErrorCodes.AuthenticationFailed) {
      vscode.window.showErrorMessage('Git authentication failed.');
    } else {
      vscode.window.showErrorMessage(`Git operation failed: ${error.message}`);
    }
  }
}
```

---

## 2. Git Context for LLM/AI Assistants

### 2.1 What Git Information is Most Valuable

Based on analysis of leading AI coding assistants (Cursor, GitHub Copilot, Claude Code):

**Essential Context:**
1. **Current Branch Name**: Identifies the working context
2. **Recent Commit History**: Shows recent changes and intent (5-10 commits)
3. **Working Tree Status**: Modified, staged, and untracked files
4. **Remote Information**: Repository URL (sanitized), upstream branch
5. **Diff of Unstaged Changes**: What's currently being worked on

**Valuable Additional Context:**
6. **Commit Messages**: Reveals intent and reasoning
7. **Branch Relationships**: Ahead/behind counts with upstream
8. **File Change Statistics**: Lines added/removed
9. **Author Information**: Who made recent changes
10. **Git Log with Paths**: Which files were affected in recent commits

**Context Priority for Token Management:**

```typescript
interface GitContextPriority {
  essential: {
    currentBranch: string;           // 5-20 tokens
    recentCommits: Commit[];         // ~100-200 tokens per commit
    workingTreeStatus: string;       // 50-100 tokens
  };
  important: {
    unstagedDiff: string;           // Highly variable, 500-5000+ tokens
    remoteInfo: string;             // 20-50 tokens
  };
  supplemental: {
    branchList: string[];           // 10-100 tokens
    stashList: string[];            // 50-200 tokens
  };
}
```

### 2.2 Formatting Git Diffs for LLM Consumption

**Best Practices for Diff Format:**

```typescript
async function getOptimizedDiff(repo: Repository): Promise<string> {
  // Use unified diff format with minimal context
  // Flags explanation:
  // --unified=0 or -U0: No context lines (reduces tokens significantly)
  // --no-color: Remove ANSI color codes
  // --minimal: Spend extra time to find minimal diff
  // --no-pager: Send to stdout directly

  const diff = await repo.diff(true, '--unified=0', '--no-color', '--minimal');
  return diff;
}

async function getSmartContextDiff(repo: Repository): Promise<string> {
  // For AI assistants that benefit from some context:
  // -U1: One line of context (good balance)
  // -U3: Default, three lines (more context but more tokens)

  const diff = await repo.diff(true, '--unified=1', '--no-color');
  return diff;
}
```

**Research Findings:**

- **Average PR Token Count**: ~2,300 tokens when processed by AI tools
- **Unified Diff Format**: Preferred by GPT-4 and other models (aider uses this by default)
- **Context Lines**: Using `-U0` reduces token count by 30-50% but may reduce accuracy
- **-U1 or -U3**: Better balance for complex changes where surrounding code matters

**Token Optimization Strategies:**

```typescript
function optimizeDiffForLLM(diff: string, maxTokens: number = 4000): string {
  // Remove large/irrelevant sections
  const excludePatterns = [
    /^diff --git a\/package-lock\.json/m,
    /^diff --git a\/yarn\.lock/m,
    /^diff --git a\/.*\.min\.js/m,
  ];

  let optimized = diff;
  for (const pattern of excludePatterns) {
    optimized = optimized.replace(pattern, '');
  }

  // If still too large, summarize
  const estimatedTokens = optimized.length / 4; // Rough estimate: 4 chars per token
  if (estimatedTokens > maxTokens) {
    return summarizeLargeDiff(diff);
  }

  return optimized;
}

function summarizeLargeDiff(diff: string): string {
  // Extract file-level changes only
  const fileChanges = diff.match(/^diff --git a\/.+ b\/.+$/gm) || [];
  const additions = (diff.match(/^\+/gm) || []).length;
  const deletions = (diff.match(/^-/gm) || []).length;

  return `
Large diff summary:
Files changed: ${fileChanges.length}
Lines added: ${additions}
Lines deleted: ${deletions}

Changed files:
${fileChanges.join('\n')}

Note: Full diff truncated due to size. Request specific file diffs if needed.
  `.trim();
}
```

### 2.3 Commit History Presentation

```typescript
async function formatCommitHistoryForLLM(
  repo: Repository,
  count: number = 10
): Promise<string> {
  const commits = await repo.log({ maxEntries: count });

  return commits.map(commit => {
    // Format: hash | date | author | message
    const date = new Date(commit.authorDate || 0).toISOString().split('T')[0];
    const shortHash = commit.hash.substring(0, 7);
    const author = commit.authorName || 'Unknown';
    const message = commit.message.split('\n')[0]; // First line only

    return `${shortHash} | ${date} | ${author} | ${message}`;
  }).join('\n');
}

// Example output:
// a1b2c3d | 2025-10-28 | John Doe | Add user authentication
// b2c3d4e | 2025-10-27 | Jane Smith | Fix login bug
// c3d4e5f | 2025-10-26 | John Doe | Update dependencies
```

### 2.4 Branch Comparison Strategies

```typescript
async function getBranchComparisonContext(
  repo: Repository,
  baseBranch: string = 'main'
): Promise<string> {
  const currentBranch = repo.state.HEAD?.name || 'unknown';

  if (currentBranch === baseBranch) {
    return 'Currently on base branch';
  }

  try {
    // Get commits between branches
    const behindCount = repo.state.HEAD?.behind || 0;
    const aheadCount = repo.state.HEAD?.ahead || 0;

    // Get diff between branches
    const diff = await repo.diffBetween(baseBranch, currentBranch);

    return `
Branch: ${currentBranch}
Base: ${baseBranch}
Status: ${aheadCount} commits ahead, ${behindCount} commits behind

${diff}
    `.trim();
  } catch (error) {
    return `Could not compare branches: ${error}`;
  }
}
```

### 2.5 Model Context Protocol (MCP) Integration

**Emerging Standard:** GitKraken and other tools are adopting MCP to provide structured Git context to AI assistants.

**Benefits:**
- Structured, permissioned access to Git data
- Standard protocol for AI assistants (Cursor, Claude Code, Copilot)
- Enables queries like "Who last changed the login function and why?"

**For ContextPack-Pro:** Consider structuring Git data in MCP-compatible format for future integration.

---

## 3. User Experience Patterns

### 3.1 When to Show/Hide Git Information

```typescript
class GitInfoProvider {
  async shouldShowGitInfo(): Promise<boolean> {
    const api = await getGitAPI();
    if (!api) {
      return false; // Git extension disabled
    }

    if (api.repositories.length === 0) {
      return false; // No repositories open
    }

    // Check workspace settings
    const config = vscode.workspace.getConfiguration('contextpack');
    const includeGit = config.get<boolean>('includeGitInfo', true);

    return includeGit;
  }

  async getGitInfoLevel(): Promise<'minimal' | 'standard' | 'detailed'> {
    const config = vscode.workspace.getConfiguration('contextpack');
    return config.get<string>('gitInfoLevel', 'standard') as any;
  }
}
```

**UX Recommendations:**

1. **Default to Including Git Info**: Most developers find it useful
2. **Provide Granular Controls**: Allow users to choose detail level
3. **Show Visual Indicators**: Icon or badge when Git info is included
4. **Handle Gracefully When Unavailable**: Don't show errors, just omit section

### 3.2 Handling Repositories with No Remotes

```typescript
function formatRemoteInfo(repo: Repository): string {
  const remotes = repo.state.remotes;

  if (remotes.length === 0) {
    return 'Repository: Local only (no remotes configured)';
  }

  const origin = remotes.find(r => r.name === 'origin');
  if (origin) {
    return `Repository: ${sanitizeRemoteUrl(origin.fetchUrl || origin.pushUrl || 'unknown')}`;
  }

  return `Repository: ${remotes.length} remote(s) configured`;
}
```

### 3.3 Dealing with Detached HEAD States

```typescript
function formatHeadInfo(repo: Repository): string {
  const head = repo.state.HEAD;

  if (!head) {
    return 'Repository: No HEAD (empty repository)';
  }

  if (!head.name) {
    // Detached HEAD state
    const commit = head.commit?.substring(0, 7) || 'unknown';
    return `Repository: Detached HEAD at ${commit}`;
  }

  // Normal branch
  const upstream = head.upstream;
  if (upstream) {
    const ahead = head.ahead || 0;
    const behind = head.behind || 0;
    return `Branch: ${head.name} (↑${ahead} ↓${behind} ${upstream.name})`;
  }

  return `Branch: ${head.name} (no upstream)`;
}
```

### 3.4 Submodule Handling

```typescript
async function detectSubmodules(repo: Repository): Promise<boolean> {
  // Check if .gitmodules exists
  const gitmodulesPath = vscode.Uri.joinPath(repo.rootUri, '.gitmodules');

  try {
    await vscode.workspace.fs.stat(gitmodulesPath);
    return true;
  } catch {
    return false;
  }
}

function formatSubmoduleWarning(): string {
  return `
Note: This repository contains Git submodules.
Submodule status is not included in this context.
Use 'git submodule status' for submodule information.
  `.trim();
}
```

**Best Practice:** VS Code's Git API has limited submodule support. For ContextPack-Pro:
- Detect presence of submodules
- Include a note in the context
- Don't attempt to recursively process submodules (performance concern)

### 3.5 Multi-Repository Workspace Scenarios

```typescript
async function getMultiRepoContext(api: GitAPI): Promise<string> {
  const repos = api.repositories;

  if (repos.length === 0) {
    return 'No Git repositories detected in workspace';
  }

  if (repos.length === 1) {
    return formatSingleRepoContext(repos[0]);
  }

  // Multiple repositories
  return `
Multiple Git Repositories (${repos.length}):

${repos.map((repo, index) => {
  const name = vscode.workspace.asRelativePath(repo.rootUri.fsPath);
  const branch = repo.state.HEAD?.name || 'detached';
  return `${index + 1}. ${name} [${branch}]`;
}).join('\n')}

Note: Use workspace root as context for multi-repository workspaces.
  `.trim();
}
```

**VS Code Multi-Repository Support:**
- VS Code 1.20+ has `git.autoRepositoryDetection` (default: true)
- Detects repos in parent folders and subfolders
- Each repository gets its own source control UI
- API provides `api.repositories` array with all detected repos

---

## 4. Security and Privacy

### 4.1 Sanitizing Remote URLs

**Critical Security Concern:** Git remote URLs can contain embedded credentials.

```typescript
function sanitizeRemoteUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Remove username and password
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
    }

    return parsed.toString();
  } catch {
    // Not a valid URL, try regex approach
    return url.replace(
      /(https?:\/\/)[^:@]+:[^@]+@/g,
      '$1[CREDENTIALS_REMOVED]@'
    );
  }
}

// Examples:
// https://user:token@github.com/repo.git
// → https://github.com/repo.git
//
// https://ghp_token123@github.com/repo.git
// → https://github.com/repo.git
```

**Git's Built-in Sanitization:**
- Git 2.9.3+ (2016): Started anonymizing URLs in error messages
- Git 2.22 (2019): Strips usernames and passwords from user-facing messages
- Git 2.27 (2020): Redacts credentials in verbose trace messages

**Best Practice:** Always sanitize URLs before including in context, even though Git itself sanitizes in most cases.

### 4.2 Handling Sensitive Data in Commit Messages

```typescript
interface SensitivePatterns {
  apiKeys: RegExp[];
  tokens: RegExp[];
  passwords: RegExp[];
  secrets: RegExp[];
}

const SENSITIVE_PATTERNS: SensitivePatterns = {
  apiKeys: [
    /api[_-]?key["\s:=]+[a-zA-Z0-9_\-]{16,}/gi,
    /["\s](sk-[a-zA-Z0-9]{48})["\s]/g, // OpenAI keys
  ],
  tokens: [
    /token["\s:=]+[a-zA-Z0-9_\-]{16,}/gi,
    /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}/g, // GitHub tokens
  ],
  passwords: [
    /password["\s:=]+[^\s"]{8,}/gi,
  ],
  secrets: [
    /secret["\s:=]+[^\s"]{8,}/gi,
  ],
};

function detectSensitiveInfo(text: string): boolean {
  for (const category of Object.values(SENSITIVE_PATTERNS)) {
    for (const pattern of category) {
      if (pattern.test(text)) {
        return true;
      }
    }
  }
  return false;
}

function sanitizeCommitMessages(commits: Commit[]): Commit[] {
  return commits.map(commit => {
    if (detectSensitiveInfo(commit.message)) {
      return {
        ...commit,
        message: '[COMMIT MESSAGE REDACTED - MAY CONTAIN SENSITIVE INFO]',
      };
    }
    return commit;
  });
}
```

### 4.3 Branch Name Privacy Considerations

```typescript
function shouldRedactBranchName(branchName: string): boolean {
  // Check for potentially sensitive patterns
  const sensitivePatterns = [
    /ticket-\d+/i,           // Internal ticket numbers
    /jira-[A-Z]+-\d+/i,      // JIRA tickets
    /customer-[a-z0-9]+/i,   // Customer identifiers
    /user-\d+/i,             // User IDs
  ];

  return sensitivePatterns.some(pattern => pattern.test(branchName));
}

function redactBranchName(branchName: string): string {
  // Replace specific parts while keeping structure
  return branchName
    .replace(/\d+/g, 'XXX')
    .replace(/[a-z]{3,}/gi, word =>
      word.charAt(0) + 'X'.repeat(word.length - 1)
    );
}
```

### 4.4 Best Practices for Context Sharing

```typescript
interface GitContextOptions {
  includeRemoteUrls: boolean;      // Default: true (sanitized)
  includeCommitMessages: boolean;  // Default: true (checked for secrets)
  includeDiffs: boolean;           // Default: true (checked for secrets)
  includeAuthorInfo: boolean;      // Default: true (emails may be PII)
  redactBranchNames: boolean;      // Default: false
  maxCommitCount: number;          // Default: 10
  maxDiffSize: number;             // Default: 100KB
}

async function getSecureGitContext(
  repo: Repository,
  options: Partial<GitContextOptions> = {}
): Promise<string> {
  const opts: GitContextOptions = {
    includeRemoteUrls: true,
    includeCommitMessages: true,
    includeDiffs: true,
    includeAuthorInfo: true,
    redactBranchNames: false,
    maxCommitCount: 10,
    maxDiffSize: 100 * 1024, // 100KB
    ...options,
  };

  let context = '# Git Context\n\n';

  // Branch info
  const branch = repo.state.HEAD?.name || 'unknown';
  context += `Branch: ${opts.redactBranchNames ? redactBranchName(branch) : branch}\n`;

  // Remote info (always sanitized)
  if (opts.includeRemoteUrls) {
    const remote = repo.state.remotes.find(r => r.name === 'origin');
    if (remote) {
      context += `Remote: ${sanitizeRemoteUrl(remote.fetchUrl || 'unknown')}\n`;
    }
  }

  // Commits
  if (opts.includeCommitMessages) {
    const commits = await repo.log({ maxEntries: opts.maxCommitCount });
    const sanitized = sanitizeCommitMessages(commits);
    context += '\n## Recent Commits\n\n';
    context += formatCommits(sanitized, opts.includeAuthorInfo);
  }

  // Diffs
  if (opts.includeDiffs) {
    const diff = await repo.diff(true);
    if (diff.length <= opts.maxDiffSize) {
      if (!detectSensitiveInfo(diff)) {
        context += '\n## Working Tree Changes\n\n```diff\n' + diff + '\n```\n';
      } else {
        context += '\n## Working Tree Changes\n\n[REDACTED - Diff contains potential sensitive information]\n';
      }
    } else {
      context += `\n## Working Tree Changes\n\n[Diff too large: ${diff.length} bytes, max: ${opts.maxDiffSize} bytes]\n`;
    }
  }

  return context;
}
```

**Privacy Configuration Recommendations:**

For ContextPack-Pro, provide settings like:

```json
{
  "contextpack.git.includeRemoteUrls": true,
  "contextpack.git.includeAuthorEmails": true,
  "contextpack.git.includeDiffs": true,
  "contextpack.git.maxDiffSize": 102400,
  "contextpack.git.checkForSecrets": true,
  "contextpack.git.redactBranchNames": false
}
```

---

## 5. Performance and Caching

### 5.1 Performance Considerations

**Known Issues:**
- Git operations in VS Code can be slow on large repositories
- Status updates can take 1-3 seconds on repos with 1000+ changed files
- VS Code has a default limit of 10,000 changes (configurable via `git.statusLimit`)

```typescript
class GitCacheManager {
  private cache = new Map<string, CachedGitInfo>();
  private readonly cacheDuration = 5000; // 5 seconds

  async getGitInfo(repo: Repository): Promise<GitInfo> {
    const cacheKey = repo.rootUri.fsPath;
    const cached = this.cache.get(cacheKey);

    const now = Date.now();
    if (cached && (now - cached.timestamp) < this.cacheDuration) {
      return cached.data;
    }

    // Fetch fresh data
    const data = await this.fetchGitInfo(repo);

    this.cache.set(cacheKey, {
      data,
      timestamp: now,
    });

    return data;
  }

  invalidate(repo: Repository): void {
    this.cache.delete(repo.rootUri.fsPath);
  }

  clear(): void {
    this.cache.clear();
  }
}
```

### 5.2 Caching Strategies

**VS Code Storage Options:**

```typescript
class GitInfoCache {
  constructor(private context: vscode.ExtensionContext) {}

  // Workspace-specific cache
  async getCachedForWorkspace(key: string): Promise<any> {
    return this.context.workspaceState.get(key);
  }

  async setCachedForWorkspace(key: string, value: any): Promise<void> {
    await this.context.workspaceState.update(key, value);
  }

  // Global cache (across all workspaces)
  async getCachedGlobally(key: string): Promise<any> {
    return this.context.globalState.get(key);
  }

  async setCachedGlobally(key: string, value: any): Promise<void> {
    await this.context.globalState.update(key, value);
  }
}
```

**Storage Locations:**
- **macOS**: `~/Library/Application Support/Code/User/globalStorage/state.vscdb` (SQLite)
- **Windows**: `%APPDATA%\Code\User\globalStorage\state.vscdb`
- **Linux**: `~/.config/Code/User/globalStorage/state.vscdb`

**Workspace State**: `~/Library/Application Support/Code/User/workspaceStorage/<id>/state.vscdb`

### 5.3 Event-Driven Updates vs Polling

**Anti-Pattern: Polling**
```typescript
// DON'T DO THIS
setInterval(async () => {
  const api = await getGitAPI();
  if (api && api.repositories.length > 0) {
    await api.repositories[0].status(); // Expensive!
    updateUI();
  }
}, 1000);
```

**Best Practice: Event-Driven**
```typescript
// DO THIS INSTEAD
async function setupEfficientGitMonitoring(
  api: GitAPI,
  context: vscode.ExtensionContext
) {
  // Listen to state changes
  for (const repo of api.repositories) {
    const disposable = repo.state.onDidChange(() => {
      // State has already been updated, just read it
      const info = extractGitInfo(repo.state);
      updateUI(info);
    });

    context.subscriptions.push(disposable);
  }

  // Listen for new repos
  context.subscriptions.push(
    api.onDidOpenRepository(repo => {
      const disposable = repo.state.onDidChange(() => {
        updateUI(extractGitInfo(repo.state));
      });
      context.subscriptions.push(disposable);
    })
  );
}
```

### 5.4 Optimizing Large Repository Handling

```typescript
async function getOptimizedGitContext(repo: Repository): Promise<string> {
  // Check repository size
  const changeCount =
    (repo.state.workingTreeChanges?.length || 0) +
    (repo.state.indexChanges?.length || 0);

  if (changeCount > 1000) {
    // Large number of changes, provide summary only
    return `
Repository: ${repo.rootUri.fsPath}
Branch: ${repo.state.HEAD?.name || 'unknown'}
Changes: ${changeCount} files modified (too many to list)
Note: Use specific file queries for large changesets
    `.trim();
  }

  // Normal case - include full context
  return getFullGitContext(repo);
}
```

---

## 6. Anti-Patterns to Avoid

### 6.1 Not Checking if Extension is Active

**Anti-Pattern:**
```typescript
// BAD: Can throw if extension is disabled
const gitExtension = vscode.extensions.getExtension('vscode.git')!.exports;
const api = gitExtension.getAPI(1);
```

**Correct Pattern:**
```typescript
// GOOD: Defensive programming
const extension = vscode.extensions.getExtension('vscode.git');
if (!extension) {
  return; // Git extension not available
}
const gitExtension = extension.isActive
  ? extension.exports
  : await extension.activate();
const api = gitExtension.getAPI(1);
```

### 6.2 Assuming Repositories Are Immediately Available

**Anti-Pattern:**
```typescript
// BAD: repositories array might be empty initially
const api = await getGitAPI();
const repo = api.repositories[0]; // undefined!
```

**Correct Pattern:**
```typescript
// GOOD: Use event-driven approach
const api = await getGitAPI();

if (api.repositories.length > 0) {
  processRepository(api.repositories[0]);
}

// Listen for repositories being opened
api.onDidOpenRepository(repo => {
  processRepository(repo);
});
```

### 6.3 Misunderstanding status() Return Value

**Anti-Pattern:**
```typescript
// BAD: status() returns void, not data
const data = await repo.status();
console.log(data); // undefined!
```

**Correct Pattern:**
```typescript
// GOOD: status() updates the state, then read state
await repo.status();
const state = repo.state;
console.log(state.HEAD, state.workingTreeChanges);
```

### 6.4 Not Disposing Event Listeners

**Anti-Pattern:**
```typescript
// BAD: Memory leak!
api.onDidOpenRepository(repo => {
  console.log('Repo opened');
});
```

**Correct Pattern:**
```typescript
// GOOD: Add to context.subscriptions
const disposable = api.onDidOpenRepository(repo => {
  console.log('Repo opened');
});
context.subscriptions.push(disposable);

// Or manually dispose when done
// disposable.dispose();
```

### 6.5 Forgetting extensionDependencies

**Anti-Pattern:**
```typescript
// package.json WITHOUT extensionDependencies
{
  "name": "my-extension",
  "activationEvents": ["onStartupFinished"]
}
```

Result: Race condition - your extension might activate before Git extension.

**Correct Pattern:**
```typescript
// package.json WITH extensionDependencies
{
  "name": "my-extension",
  "extensionDependencies": ["vscode.git"],
  "activationEvents": ["onStartupFinished"]
}
```

### 6.6 Using Simple-Git Instead of Built-in API

**Context:** Some developers bypass the VS Code Git API entirely and use the `simple-git` npm package.

**When This Makes Sense:**
- Need functionality not exposed by VS Code API
- Working with Git operations outside of open workspaces
- Need more detailed control over Git commands

**When This is an Anti-Pattern:**
- Duplication: Running the same Git commands VS Code already runs
- Performance: Extra Git processes compete with VS Code's Git extension
- State Sync: Your state can diverge from VS Code's UI
- User Experience: VS Code might not reflect changes made by your extension

**Recommendation for ContextPack-Pro:** Use the built-in API for reading state, only use `simple-git` if you need operations not available in the API.

### 6.7 Not Handling Git Being Disabled

**Anti-Pattern:**
```typescript
// BAD: Assumes Git is always enabled
export function activate(context: vscode.ExtensionContext) {
  const api = await getGitAPI();
  // Crash if Git is disabled!
  api.repositories.forEach(processRepo);
}
```

**Correct Pattern:**
```typescript
// GOOD: Gracefully handle disabled Git
export async function activate(context: vscode.ExtensionContext) {
  const api = await getGitAPI();

  if (!api) {
    console.log('Git extension is disabled, Git features unavailable');
    return; // Continue without Git features
  }

  // Rest of initialization
}
```

### 6.8 Ignoring API State Property

**Anti-Pattern:**
```typescript
// BAD: Not checking if API is initialized
const api = gitExtension.getAPI(1);
api.repositories.forEach(repo => { ... }); // Might throw!
```

**Correct Pattern:**
```typescript
// GOOD: Check API state
const api = gitExtension.getAPI(1);

if (api.state === 'uninitialized') {
  // Wait for initialization
  await new Promise<void>(resolve => {
    if (api.state !== 'uninitialized') {
      resolve();
    } else {
      const disposable = api.onDidChangeState(() => {
        if (api.state !== 'uninitialized') {
          disposable.dispose();
          resolve();
        }
      });
    }
  });
}

// Now safe to use
api.repositories.forEach(repo => { ... });
```

### 6.9 Blocking the Extension Host

**Anti-Pattern:**
```typescript
// BAD: Synchronously waiting for Git operations
export function activate(context: vscode.ExtensionContext) {
  const api = getGitAPI(); // Blocks!
  const diff = repo.diff(); // Blocks!
  const log = repo.log(); // Blocks!
}
```

**Correct Pattern:**
```typescript
// GOOD: Async operations
export async function activate(context: vscode.ExtensionContext) {
  const api = await getGitAPI();

  if (!api) return;

  // Process asynchronously
  processRepositoriesAsync(api.repositories);
}

async function processRepositoriesAsync(repos: Repository[]) {
  for (const repo of repos) {
    const diff = await repo.diff();
    const log = await repo.log();
    // Process...
  }
}
```

### 6.10 Including Too Much Context

**Anti-Pattern:**
```typescript
// BAD: Dumping entire commit history
const allCommits = await repo.log({ maxEntries: 1000 });
const allDiffs = await repo.diffBetween('HEAD~1000', 'HEAD');
// Sends megabytes of data to LLM
```

**Correct Pattern:**
```typescript
// GOOD: Limit to useful recent context
const recentCommits = await repo.log({ maxEntries: 10 });
const workingDiff = await repo.diff(true); // Only working tree changes

// Implement token budgeting
const tokenBudget = 5000;
const optimizedContext = optimizeForTokenBudget(
  recentCommits,
  workingDiff,
  tokenBudget
);
```

---

## 7. Implementation Examples

### 7.1 Complete Git Context Provider for ContextPack-Pro

```typescript
import * as vscode from 'vscode';
import { GitExtension, API as GitAPI, Repository } from './git';

export class GitContextProvider {
  private api: GitAPI | undefined;
  private disposables: vscode.Disposable[] = [];

  async initialize(context: vscode.ExtensionContext): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');

      if (!extension) {
        console.log('Git extension not found');
        return false;
      }

      const gitExtension = extension.isActive
        ? extension.exports
        : await extension.activate();

      this.api = gitExtension.getAPI(1);

      // Wait for API initialization
      if (this.api.state === 'uninitialized') {
        await new Promise<void>(resolve => {
          if (this.api!.state !== 'uninitialized') {
            resolve();
          } else {
            const disposable = this.api!.onDidChangeState(() => {
              if (this.api!.state !== 'uninitialized') {
                disposable.dispose();
                resolve();
              }
            });
          }
        });
      }

      this.setupListeners(context);
      return true;
    } catch (error) {
      console.error('Failed to initialize Git context provider:', error);
      return false;
    }
  }

  private setupListeners(context: vscode.ExtensionContext): void {
    if (!this.api) return;

    // Listen for new repositories
    const repoDisposable = this.api.onDidOpenRepository(repo => {
      console.log('Repository opened:', repo.rootUri.fsPath);
    });

    // Listen for repositories being closed
    const closeDisposable = this.api.onDidCloseRepository(repo => {
      console.log('Repository closed:', repo.rootUri.fsPath);
    });

    this.disposables.push(repoDisposable, closeDisposable);
    context.subscriptions.push(...this.disposables);
  }

  async getContext(): Promise<string> {
    if (!this.api || this.api.repositories.length === 0) {
      return '# Git Context\n\nNo Git repositories detected in workspace.\n';
    }

    if (this.api.repositories.length === 1) {
      return this.getSingleRepoContext(this.api.repositories[0]);
    }

    return this.getMultiRepoContext(this.api.repositories);
  }

  private async getSingleRepoContext(repo: Repository): Promise<string> {
    const config = vscode.workspace.getConfiguration('contextpack');
    const includeCommits = config.get<boolean>('git.includeCommits', true);
    const includeDiffs = config.get<boolean>('git.includeDiffs', true);
    const maxCommitCount = config.get<number>('git.maxCommitCount', 10);

    let context = '# Git Context\n\n';

    // Basic info
    context += `Repository: ${repo.rootUri.fsPath}\n`;
    context += this.formatHeadInfo(repo) + '\n';
    context += this.formatRemoteInfo(repo) + '\n';
    context += this.formatStatusInfo(repo) + '\n';

    // Commits
    if (includeCommits) {
      try {
        const commits = await repo.log({ maxEntries: maxCommitCount });
        context += '\n## Recent Commits\n\n';
        context += this.formatCommits(commits) + '\n';
      } catch (error) {
        context += '\n## Recent Commits\n\nFailed to retrieve commits.\n';
      }
    }

    // Working tree diff
    if (includeDiffs) {
      try {
        const diff = await repo.diff(true);
        if (diff && diff.length > 0) {
          const maxDiffSize = config.get<number>('git.maxDiffSize', 102400);
          if (diff.length <= maxDiffSize) {
            context += '\n## Working Tree Changes\n\n```diff\n' + diff + '\n```\n';
          } else {
            context += `\n## Working Tree Changes\n\n[Diff too large: ${diff.length} bytes]\n`;
          }
        }
      } catch (error) {
        context += '\n## Working Tree Changes\n\nFailed to retrieve diff.\n';
      }
    }

    return context;
  }

  private async getMultiRepoContext(repos: Repository[]): Promise<string> {
    let context = `# Git Context\n\nMultiple repositories (${repos.length}):\n\n`;

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      const name = vscode.workspace.asRelativePath(repo.rootUri.fsPath);
      const branch = repo.state.HEAD?.name || 'detached';

      context += `${i + 1}. **${name}** [${branch}]\n`;
      context += `   ${this.formatStatusInfo(repo)}\n`;
    }

    return context;
  }

  private formatHeadInfo(repo: Repository): string {
    const head = repo.state.HEAD;

    if (!head) {
      return 'Status: Empty repository (no commits)';
    }

    if (!head.name) {
      const commit = head.commit?.substring(0, 7) || 'unknown';
      return `Status: Detached HEAD at ${commit}`;
    }

    const upstream = head.upstream;
    if (upstream) {
      const ahead = head.ahead || 0;
      const behind = head.behind || 0;
      return `Branch: ${head.name} (${ahead} ahead, ${behind} behind ${upstream.name})`;
    }

    return `Branch: ${head.name} (no upstream)`;
  }

  private formatRemoteInfo(repo: Repository): string {
    const remotes = repo.state.remotes;

    if (remotes.length === 0) {
      return 'Remote: None (local repository only)';
    }

    const origin = remotes.find(r => r.name === 'origin');
    if (origin) {
      const url = this.sanitizeUrl(origin.fetchUrl || origin.pushUrl || '');
      return `Remote: ${url}`;
    }

    return `Remotes: ${remotes.length} configured`;
  }

  private formatStatusInfo(repo: Repository): string {
    const working = repo.state.workingTreeChanges?.length || 0;
    const staged = repo.state.indexChanges?.length || 0;

    if (working === 0 && staged === 0) {
      return 'Working tree clean';
    }

    const parts: string[] = [];
    if (staged > 0) parts.push(`${staged} staged`);
    if (working > 0) parts.push(`${working} modified`);

    return `Changes: ${parts.join(', ')}`;
  }

  private formatCommits(commits: any[]): string {
    return commits.map(commit => {
      const date = new Date(commit.authorDate || 0).toISOString().split('T')[0];
      const shortHash = commit.hash.substring(0, 7);
      const author = commit.authorName || 'Unknown';
      const message = commit.message.split('\n')[0]; // First line only

      return `- ${shortHash} | ${date} | ${author} | ${message}`;
    }).join('\n');
  }

  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      return url.replace(/(https?:\/\/)[^:@]+:[^@]+@/g, '$1***@');
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
```

### 7.2 Integration with Existing ContextPack-Pro

```typescript
// In extension.ts

import { GitContextProvider } from './gitContextProvider';

let gitContextProvider: GitContextProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize Git context provider
  gitContextProvider = new GitContextProvider();
  const gitAvailable = await gitContextProvider.initialize(context);

  if (gitAvailable) {
    console.log('Git context provider initialized successfully');
  } else {
    console.log('Git context provider not available');
  }

  // Existing commands...

  // Modified copy context command
  let disposable = vscode.commands.registerCommand(
    'contextpack.copyContext',
    async () => {
      let context = '';

      // Existing file context gathering...
      context += await getFileContext();

      // Add Git context if available
      if (gitContextProvider) {
        const gitContext = await gitContextProvider.getContext();
        context += '\n\n---\n\n' + gitContext;
      }

      // Copy to clipboard
      await vscode.env.clipboard.writeText(context);
      vscode.window.showInformationMessage('Context copied to clipboard!');
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  gitContextProvider?.dispose();
}
```

### 7.3 Configuration Settings

Add to `package.json`:

```json
{
  "contributes": {
    "configuration": {
      "title": "ContextPack Pro",
      "properties": {
        "contextpack.git.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Include Git information in context"
        },
        "contextpack.git.includeCommits": {
          "type": "boolean",
          "default": true,
          "description": "Include recent commit history"
        },
        "contextpack.git.maxCommitCount": {
          "type": "number",
          "default": 10,
          "minimum": 1,
          "maximum": 100,
          "description": "Maximum number of recent commits to include"
        },
        "contextpack.git.includeDiffs": {
          "type": "boolean",
          "default": true,
          "description": "Include working tree diff"
        },
        "contextpack.git.maxDiffSize": {
          "type": "number",
          "default": 102400,
          "description": "Maximum diff size in bytes (default: 100KB)"
        },
        "contextpack.git.includeRemoteUrls": {
          "type": "boolean",
          "default": true,
          "description": "Include remote repository URLs (sanitized)"
        },
        "contextpack.git.includeAuthorInfo": {
          "type": "boolean",
          "default": true,
          "description": "Include commit author names and emails"
        }
      }
    }
  }
}
```

---

## Summary and Recommendations

### For ContextPack-Pro Implementation

1. **Start Simple**: Begin with basic Git info (branch, status, recent commits)
2. **Use Event-Driven Architecture**: Listen to Git state changes rather than polling
3. **Security First**: Always sanitize URLs and check for sensitive data
4. **Performance**: Cache Git data with 5-second TTL, avoid blocking operations
5. **User Control**: Provide granular settings for what Git info to include
6. **Graceful Degradation**: Work fine when Git is unavailable or disabled
7. **Token Budget**: Implement smart truncation for large diffs (100KB limit recommended)
8. **Multi-Repo Support**: Handle workspaces with multiple Git repositories

### Implementation Priority

**Phase 1 (MVP):**
- Basic Git detection and availability check
- Current branch name
- Working tree status (modified/staged file counts)
- Repository remote URL (sanitized)

**Phase 2 (Enhanced):**
- Recent commit history (configurable count)
- Working tree diff (with size limits)
- Multiple repository support
- Configuration settings

**Phase 3 (Advanced):**
- Smart diff formatting for LLMs
- Sensitive data detection
- Branch comparison features
- Submodule detection and warnings

### Key Takeaways

1. **Official API**: Use `vscode.git` extension API, copy `git.d.ts`, declare `extensionDependencies`
2. **Event-Driven**: Use `onDidOpenRepository` and `repo.state.onDidChange`, never poll
3. **Memory Management**: Always add disposables to `context.subscriptions`
4. **Security**: Sanitize URLs, detect sensitive patterns, provide user controls
5. **Performance**: Cache with TTL, use event-driven updates, limit data size
6. **LLM Context**: Use unified diff format with `-U0` or `-U1`, limit to ~2-5K tokens
7. **User Experience**: Graceful fallbacks, clear status indicators, granular settings

### References

- **Official API**: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
- **Git Extension README**: https://github.com/microsoft/vscode/blob/main/extensions/git/README.md
- **SCM API Guide**: https://code.visualstudio.com/api/extension-guides/scm-provider
- **GitLens Extension**: https://github.com/gitkraken/vscode-gitlens
- **GitHub PR Extension**: https://github.com/microsoft/vscode-pull-request-github

---

**Document Version:** 1.0
**Last Updated:** October 29, 2025
**Author:** Research compiled for ContextPack-Pro

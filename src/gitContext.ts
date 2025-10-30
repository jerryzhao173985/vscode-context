import * as vscode from 'vscode';
import { GitExtension, API as GitAPI, Repository } from './git';

export class GitContextProvider {
  private api: GitAPI | undefined;
  private disposables: vscode.Disposable[] = [];
  private cache: Map<string, { data: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

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
      this.invalidateCache();

      // Listen for state changes on this repository
      const stateDisposable = repo.state.onDidChange(() => {
        this.invalidateCache();
      });
      this.disposables.push(stateDisposable);
    });

    // Listen for repositories being closed
    const closeDisposable = this.api.onDidCloseRepository(repo => {
      console.log('Repository closed:', repo.rootUri.fsPath);
      this.invalidateCache();
    });

    this.disposables.push(repoDisposable, closeDisposable);
    context.subscriptions.push(...this.disposables);
  }

  private invalidateCache(): void {
    this.cache.clear();
  }

  async getContext(): Promise<string> {
    const cacheKey = 'git-context';
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    if (!this.api || this.api.repositories.length === 0) {
      return '# Git Context\n\nNo Git repositories detected in workspace.\n';
    }

    const context = this.api.repositories.length === 1
      ? await this.getSingleRepoContext(this.api.repositories[0])
      : await this.getMultiRepoContext(this.api.repositories);

    this.cache.set(cacheKey, { data: context, timestamp: Date.now() });
    return context;
  }

  private async getSingleRepoContext(repo: Repository): Promise<string> {
    const config = vscode.workspace.getConfiguration('copyContext');
    const includeGitInfo = config.get<boolean>('includeGitInfo', true);
    const includeDiff = config.get<boolean>('includeDiff', true);
    const commitHistoryLimit = config.get<number>('commitHistoryLimit', 5);
    const diffContext = config.get<number>('diffContext', 3);

    if (!includeGitInfo) {
      return '';
    }

    let context = '# Git Context\n\n';

    // Basic info
    context += `**Repository:** ${repo.rootUri.fsPath}\n`;
    context += `**${this.formatHeadInfo(repo)}**\n`;
    context += `**${this.formatRemoteInfo(repo)}**\n`;
    context += `**${this.formatStatusInfo(repo)}**\n`;

    // Recent commits
    if (commitHistoryLimit > 0) {
      try {
        const commits = await repo.log({ maxEntries: commitHistoryLimit });
        if (commits && commits.length > 0) {
          context += '\n## Recent Commits\n\n';
          context += this.formatCommits(commits) + '\n';
        }
      } catch (error) {
        context += '\n## Recent Commits\n\nFailed to retrieve commits.\n';
      }
    }

    // Working tree diff
    // Note: VS Code Git API diff() only accepts cached boolean parameter
    // Custom diff context lines (diffContext config) cannot be applied via this API
    if (includeDiff && repo.state.workingTreeChanges && repo.state.workingTreeChanges.length > 0) {
      try {
        const diff = await repo.diff(true);
        if (diff && diff.length > 0) {
          const maxDiffSize = 102400; // 100KB
          if (diff.length <= maxDiffSize) {
            context += '\n## Working Tree Changes\n\n```diff\n' + diff + '\n```\n';
          } else {
            context += `\n## Working Tree Changes\n\n[Diff too large: ${(diff.length / 1024).toFixed(1)}KB - showing summary only]\n\n`;
            context += this.summarizeDiff(diff) + '\n';
          }
        }
      } catch (error) {
        console.error('Failed to retrieve diff:', error);
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
      let status = `Branch: ${head.name}`;

      if (ahead > 0 || behind > 0) {
        status += ` (${ahead} ahead, ${behind} behind ${upstream.name})`;
      } else {
        status += ` (up to date with ${upstream.name})`;
      }

      return status;
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
      return 'Working tree: clean';
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

      return `- \`${shortHash}\` | ${date} | ${author} | ${message}`;
    }).join('\n');
  }

  private sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    } catch {
      // Handle non-URL formats (e.g., git@github.com:user/repo.git)
      return url.replace(/(https?:\/\/)[^:@]+:[^@]+@/g, '$1***@');
    }
  }

  private summarizeDiff(diff: string): string {
    const fileChanges = diff.match(/^diff --git a\/.+ b\/.+$/gm) || [];
    const additions = (diff.match(/^\+(?!\+\+)/gm) || []).length;
    const deletions = (diff.match(/^-(?!--)/gm) || []).length;

    let summary = `**Files changed:** ${fileChanges.length}\n`;
    summary += `**Lines added:** ${additions}\n`;
    summary += `**Lines deleted:** ${deletions}\n\n`;
    summary += '**Changed files:**\n';
    summary += fileChanges.map(line => {
      const match = line.match(/b\/(.+)$/);
      return match ? `- ${match[1]}` : '';
    }).filter(Boolean).join('\n');

    return summary;
  }

  /**
   * Get a list of modified files with their status
   */
  async getModifiedFiles(): Promise<Array<{ uri: vscode.Uri; status: string }>> {
    if (!this.api || this.api.repositories.length === 0) {
      return [];
    }

    const repo = this.api.repositories[0];
    const files: Array<{ uri: vscode.Uri; status: string }> = [];

    // Working tree changes
    for (const change of repo.state.workingTreeChanges || []) {
      files.push({
        uri: change.uri,
        status: this.getStatusText(change.status)
      });
    }

    // Staged changes
    for (const change of repo.state.indexChanges || []) {
      files.push({
        uri: change.uri,
        status: this.getStatusText(change.status) + ' (staged)'
      });
    }

    return files;
  }

  private getStatusText(status: number): string {
    // Based on git.d.ts Status enum
    switch (status) {
      case 0: return 'INDEX_MODIFIED';
      case 1: return 'INDEX_ADDED';
      case 2: return 'INDEX_DELETED';
      case 3: return 'INDEX_RENAMED';
      case 4: return 'INDEX_COPIED';
      case 5: return 'MODIFIED';
      case 6: return 'DELETED';
      case 7: return 'UNTRACKED';
      case 8: return 'IGNORED';
      case 9: return 'INTENT_TO_ADD';
      case 10: return 'ADDED_BY_US';
      case 11: return 'ADDED_BY_THEM';
      case 12: return 'DELETED_BY_US';
      case 13: return 'DELETED_BY_THEM';
      case 14: return 'BOTH_ADDED';
      case 15: return 'BOTH_DELETED';
      case 16: return 'BOTH_MODIFIED';
      default: return 'UNKNOWN';
    }
  }

  /**
   * Get the primary repository (first one if multiple)
   */
  getRepository(): Repository | undefined {
    if (!this.api || this.api.repositories.length === 0) {
      return undefined;
    }
    return this.api.repositories[0];
  }

  /**
   * Check if Git is available
   */
  isAvailable(): boolean {
    return this.api !== undefined && this.api.repositories.length > 0;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
    this.cache.clear();
  }
}

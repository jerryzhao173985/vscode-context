import * as vscode from 'vscode';
import * as path from 'path';
import { TokenCounter } from './tokenCounter';

export type GroupingStrategy =
  | 'none'            // No grouping (flat list)
  | 'directory'       // Group by directory structure
  | 'file-type'       // Group by file extension
  | 'git-status'      // Group by git status
  | 'size'            // Group by file size (small, medium, large)
  | 'tokens'          // Group by token count
  | 'recency'         // Group by modification date
  | 'relationship'    // Group by relationship strength
  | 'custom';         // Custom user-defined groups

export interface GroupNode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  files: vscode.Uri[];
  children?: GroupNode[];
  metadata?: {
    totalTokens?: number;
    totalSize?: number;
    averageScore?: number;
    fileCount?: number;
  };
}

export interface GroupingOptions {
  strategy: GroupingStrategy;
  maxDepth?: number;           // For directory grouping
  minFilesPerGroup?: number;   // Minimum files to create a group
  sortWithinGroups?: 'name' | 'size' | 'tokens' | 'score';
  collapsible?: boolean;
}

export interface FileMetadata {
  uri: vscode.Uri;
  size?: number;
  tokens?: number;
  modified?: Date;
  gitStatus?: string;
  score?: number;
  relationships?: string[];
}

/**
 * Smart File Grouping Engine
 * Provides intelligent file grouping strategies for the TreeView
 */
export class SmartFileGrouping {
  constructor(
    private tokenCounter: TokenCounter
  ) {}

  /**
   * Group files according to specified strategy
   */
  async groupFiles(
    files: vscode.Uri[],
    options: GroupingOptions,
    metadata?: Map<string, FileMetadata>
  ): Promise<GroupNode[]> {
    if (files.length === 0) {
      return [];
    }

    // Get or create metadata
    const fileMetadata = metadata || await this.collectMetadata(files);

    let groups: GroupNode[];

    switch (options.strategy) {
      case 'none':
        groups = this.createFlatList(files, fileMetadata);
        break;

      case 'directory':
        groups = this.groupByDirectory(files, fileMetadata, options);
        break;

      case 'file-type':
        groups = this.groupByFileType(files, fileMetadata);
        break;

      case 'git-status':
        groups = this.groupByGitStatus(files, fileMetadata);
        break;

      case 'size':
        groups = this.groupBySize(files, fileMetadata);
        break;

      case 'tokens':
        groups = this.groupByTokens(files, fileMetadata);
        break;

      case 'recency':
        groups = this.groupByRecency(files, fileMetadata);
        break;

      case 'relationship':
        groups = this.groupByRelationship(files, fileMetadata);
        break;

      case 'custom':
        groups = this.groupByCustom(files, fileMetadata);
        break;

      default:
        groups = this.createFlatList(files, fileMetadata);
    }

    // Apply sorting within groups
    if (options.sortWithinGroups) {
      groups = this.sortGroupContents(groups, options.sortWithinGroups, fileMetadata);
    }

    // Filter out groups with too few files
    if (options.minFilesPerGroup && options.minFilesPerGroup > 1) {
      groups = this.filterSmallGroups(groups, options.minFilesPerGroup);
    }

    return groups;
  }

  /**
   * Collect metadata for all files
   */
  private async collectMetadata(files: vscode.Uri[]): Promise<Map<string, FileMetadata>> {
    const metadata = new Map<string, FileMetadata>();

    for (const uri of files) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const tokens = this.tokenCounter.countTokens(document.getText());

        metadata.set(uri.fsPath, {
          uri,
          size: stat.size,
          tokens,
          modified: new Date(stat.mtime)
        });
      } catch (error) {
        // If we can't read the file, just add basic metadata
        metadata.set(uri.fsPath, { uri });
      }
    }

    return metadata;
  }

  /**
   * Create flat list (no grouping)
   */
  private createFlatList(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    const group: GroupNode = {
      id: 'all-files',
      label: `All Files (${files.length})`,
      icon: 'files',
      files: [...files],
      metadata: this.calculateGroupMetadata(files, metadata)
    };

    return [group];
  }

  /**
   * Group by directory structure
   */
  private groupByDirectory(
    files: vscode.Uri[],
    metadata: Map<string, FileMetadata>,
    options: GroupingOptions
  ): GroupNode[] {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return this.createFlatList(files, metadata);
    }

    const maxDepth = options.maxDepth || 2;
    const tree = new Map<string, vscode.Uri[]>();

    // Build directory tree
    for (const file of files) {
      const relativePath = path.relative(workspaceFolder.uri.fsPath, file.fsPath);
      const parts = relativePath.split(path.sep);

      // Limit depth
      const depth = Math.min(parts.length - 1, maxDepth);
      const dirPath = parts.slice(0, depth).join(path.sep) || 'root';

      if (!tree.has(dirPath)) {
        tree.set(dirPath, []);
      }
      tree.get(dirPath)!.push(file);
    }

    // Convert to group nodes
    const groups: GroupNode[] = [];
    for (const [dirPath, dirFiles] of tree.entries()) {
      const dirName = dirPath === 'root' ? '📁 Root' : `📁 ${path.basename(dirPath)}`;

      groups.push({
        id: `dir-${dirPath}`,
        label: dirName,
        description: dirPath === 'root' ? undefined : dirPath,
        icon: 'folder',
        files: dirFiles,
        metadata: this.calculateGroupMetadata(dirFiles, metadata)
      });
    }

    // Sort by name
    return groups.sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Group by file type/extension
   */
  private groupByFileType(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    const typeMap = new Map<string, vscode.Uri[]>();

    for (const file of files) {
      const ext = path.extname(file.fsPath).toLowerCase();
      const type = ext || 'no-extension';

      if (!typeMap.has(type)) {
        typeMap.set(type, []);
      }
      typeMap.get(type)!.push(file);
    }

    const groups: GroupNode[] = [];
    for (const [type, typeFiles] of typeMap.entries()) {
      const label = type === 'no-extension' ? 'No Extension' : this.getFileTypeLabel(type);
      const icon = this.getFileTypeIcon(type);

      groups.push({
        id: `type-${type}`,
        label: `${icon} ${label} (${typeFiles.length})`,
        description: type === 'no-extension' ? undefined : type,
        icon: 'symbol-file',
        files: typeFiles,
        metadata: this.calculateGroupMetadata(typeFiles, metadata)
      });
    }

    // Sort by file count (descending)
    return groups.sort((a, b) => b.files.length - a.files.length);
  }

  /**
   * Group by git status
   */
  private groupByGitStatus(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    const statusGroups = new Map<string, vscode.Uri[]>();

    for (const file of files) {
      const meta = metadata.get(file.fsPath);
      const status = meta?.gitStatus || 'clean';

      if (!statusGroups.has(status)) {
        statusGroups.set(status, []);
      }
      statusGroups.get(status)!.push(file);
    }

    const groups: GroupNode[] = [];
    const statusOrder = ['modified', 'added', 'deleted', 'untracked', 'staged', 'clean'];

    for (const status of statusOrder) {
      const statusFiles = statusGroups.get(status);
      if (!statusFiles || statusFiles.length === 0) {
        continue;
      }

      const label = this.getGitStatusLabel(status);
      const icon = this.getGitStatusIcon(status);

      groups.push({
        id: `status-${status}`,
        label: `${label} (${statusFiles.length})`,
        icon,
        files: statusFiles,
        metadata: this.calculateGroupMetadata(statusFiles, metadata)
      });
    }

    return groups;
  }

  /**
   * Group by file size
   */
  private groupBySize(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    const sizeGroups: Record<string, vscode.Uri[]> = {
      tiny: [],      // < 10 KB
      small: [],     // 10-100 KB
      medium: [],    // 100 KB - 1 MB
      large: [],     // 1-5 MB
      veryLarge: []  // > 5 MB
    };

    for (const file of files) {
      const meta = metadata.get(file.fsPath);
      const size = meta?.size || 0;

      if (size < 10 * 1024) {
        sizeGroups.tiny.push(file);
      } else if (size < 100 * 1024) {
        sizeGroups.small.push(file);
      } else if (size < 1024 * 1024) {
        sizeGroups.medium.push(file);
      } else if (size < 5 * 1024 * 1024) {
        sizeGroups.large.push(file);
      } else {
        sizeGroups.veryLarge.push(file);
      }
    }

    const groups: GroupNode[] = [];
    const sizeConfig = [
      { key: 'tiny', label: '📄 Tiny', description: '< 10 KB', icon: 'file' },
      { key: 'small', label: '📝 Small', description: '10-100 KB', icon: 'file-code' },
      { key: 'medium', label: '📋 Medium', description: '100 KB - 1 MB', icon: 'file-text' },
      { key: 'large', label: '📦 Large', description: '1-5 MB', icon: 'package' },
      { key: 'veryLarge', label: '🗂️ Very Large', description: '> 5 MB', icon: 'database' }
    ];

    for (const config of sizeConfig) {
      const groupFiles = sizeGroups[config.key as keyof typeof sizeGroups];
      if (groupFiles.length > 0) {
        groups.push({
          id: `size-${config.key}`,
          label: `${config.label} (${groupFiles.length})`,
          description: config.description,
          icon: config.icon,
          files: groupFiles,
          metadata: this.calculateGroupMetadata(groupFiles, metadata)
        });
      }
    }

    return groups;
  }

  /**
   * Group by token count
   */
  private groupByTokens(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    const tokenGroups: Record<string, vscode.Uri[]> = {
      minimal: [],    // < 500 tokens
      small: [],      // 500-2000
      medium: [],     // 2000-5000
      large: [],      // 5000-10000
      veryLarge: []   // > 10000
    };

    for (const file of files) {
      const meta = metadata.get(file.fsPath);
      const tokens = meta?.tokens || 0;

      if (tokens < 500) {
        tokenGroups.minimal.push(file);
      } else if (tokens < 2000) {
        tokenGroups.small.push(file);
      } else if (tokens < 5000) {
        tokenGroups.medium.push(file);
      } else if (tokens < 10000) {
        tokenGroups.large.push(file);
      } else {
        tokenGroups.veryLarge.push(file);
      }
    }

    const groups: GroupNode[] = [];
    const tokenConfig = [
      { key: 'minimal', label: '🟢 Minimal', description: '< 500 tokens', icon: 'circle-filled' },
      { key: 'small', label: '🔵 Small', description: '500-2K tokens', icon: 'circle-filled' },
      { key: 'medium', label: '🟡 Medium', description: '2K-5K tokens', icon: 'circle-filled' },
      { key: 'large', label: '🟠 Large', description: '5K-10K tokens', icon: 'circle-filled' },
      { key: 'veryLarge', label: '🔴 Very Large', description: '> 10K tokens', icon: 'circle-filled' }
    ];

    for (const config of tokenConfig) {
      const groupFiles = tokenGroups[config.key as keyof typeof tokenGroups];
      if (groupFiles.length > 0) {
        groups.push({
          id: `tokens-${config.key}`,
          label: `${config.label} (${groupFiles.length})`,
          description: config.description,
          icon: config.icon,
          files: groupFiles,
          metadata: this.calculateGroupMetadata(groupFiles, metadata)
        });
      }
    }

    return groups;
  }

  /**
   * Group by recency (modification date)
   */
  private groupByRecency(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);
    const thisMonth = new Date(today);
    thisMonth.setMonth(thisMonth.getMonth() - 1);

    const recencyGroups: Record<string, vscode.Uri[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      thisMonth: [],
      older: []
    };

    for (const file of files) {
      const meta = metadata.get(file.fsPath);
      const modified = meta?.modified;

      if (!modified) {
        recencyGroups.older.push(file);
        continue;
      }

      if (modified >= today) {
        recencyGroups.today.push(file);
      } else if (modified >= yesterday) {
        recencyGroups.yesterday.push(file);
      } else if (modified >= thisWeek) {
        recencyGroups.thisWeek.push(file);
      } else if (modified >= thisMonth) {
        recencyGroups.thisMonth.push(file);
      } else {
        recencyGroups.older.push(file);
      }
    }

    const groups: GroupNode[] = [];
    const recencyConfig = [
      { key: 'today', label: '📅 Today', icon: 'calendar', description: 'Modified today' },
      { key: 'yesterday', label: '📆 Yesterday', icon: 'calendar', description: 'Modified yesterday' },
      { key: 'thisWeek', label: '📊 This Week', icon: 'graph', description: 'Modified this week' },
      { key: 'thisMonth', label: '📈 This Month', icon: 'graph-line', description: 'Modified this month' },
      { key: 'older', label: '📜 Older', icon: 'history', description: 'Modified earlier' }
    ];

    for (const config of recencyConfig) {
      const groupFiles = recencyGroups[config.key as keyof typeof recencyGroups];
      if (groupFiles.length > 0) {
        groups.push({
          id: `recency-${config.key}`,
          label: `${config.label} (${groupFiles.length})`,
          description: config.description,
          icon: config.icon,
          files: groupFiles,
          metadata: this.calculateGroupMetadata(groupFiles, metadata)
        });
      }
    }

    return groups;
  }

  /**
   * Group by relationship strength
   */
  private groupByRelationship(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    const relationshipGroups: Record<string, vscode.Uri[]> = {
      strong: [],      // Many relationships
      moderate: [],    // Some relationships
      weak: [],        // Few relationships
      isolated: []     // No relationships
    };

    for (const file of files) {
      const meta = metadata.get(file.fsPath);
      const relationshipCount = meta?.relationships?.length || 0;

      if (relationshipCount === 0) {
        relationshipGroups.isolated.push(file);
      } else if (relationshipCount < 3) {
        relationshipGroups.weak.push(file);
      } else if (relationshipCount < 7) {
        relationshipGroups.moderate.push(file);
      } else {
        relationshipGroups.strong.push(file);
      }
    }

    const groups: GroupNode[] = [];
    const relationshipConfig = [
      { key: 'strong', label: '🔗 Highly Connected', description: '7+ relationships', icon: 'link' },
      { key: 'moderate', label: '🔸 Moderately Connected', description: '3-6 relationships', icon: 'symbol-interface' },
      { key: 'weak', label: '◦ Weakly Connected', description: '1-2 relationships', icon: 'symbol-method' },
      { key: 'isolated', label: '○ Isolated', description: 'No relationships', icon: 'circle-outline' }
    ];

    for (const config of relationshipConfig) {
      const groupFiles = relationshipGroups[config.key as keyof typeof relationshipGroups];
      if (groupFiles.length > 0) {
        groups.push({
          id: `relationship-${config.key}`,
          label: `${config.label} (${groupFiles.length})`,
          description: config.description,
          icon: config.icon,
          files: groupFiles,
          metadata: this.calculateGroupMetadata(groupFiles, metadata)
        });
      }
    }

    return groups;
  }

  /**
   * Custom grouping (placeholder for user-defined rules)
   */
  private groupByCustom(files: vscode.Uri[], metadata: Map<string, FileMetadata>): GroupNode[] {
    // TODO: Implement custom grouping based on user-defined rules
    // For now, fall back to directory grouping
    return this.groupByDirectory(files, metadata, { strategy: 'directory' });
  }

  /**
   * Sort files within groups
   */
  private sortGroupContents(
    groups: GroupNode[],
    sortBy: 'name' | 'size' | 'tokens' | 'score',
    metadata: Map<string, FileMetadata>
  ): GroupNode[] {
    return groups.map(group => {
      const sortedFiles = [...group.files].sort((a, b) => {
        const metaA = metadata.get(a.fsPath);
        const metaB = metadata.get(b.fsPath);

        switch (sortBy) {
          case 'name':
            return path.basename(a.fsPath).localeCompare(path.basename(b.fsPath));
          case 'size':
            return (metaB?.size || 0) - (metaA?.size || 0);
          case 'tokens':
            return (metaB?.tokens || 0) - (metaA?.tokens || 0);
          case 'score':
            return (metaB?.score || 0) - (metaA?.score || 0);
          default:
            return 0;
        }
      });

      return {
        ...group,
        files: sortedFiles,
        children: group.children ? this.sortGroupContents(group.children, sortBy, metadata) : undefined
      };
    });
  }

  /**
   * Filter out groups with too few files
   */
  private filterSmallGroups(groups: GroupNode[], minFiles: number): GroupNode[] {
    const filtered: GroupNode[] = [];
    const orphanFiles: vscode.Uri[] = [];

    for (const group of groups) {
      if (group.files.length >= minFiles) {
        filtered.push(group);
      } else {
        orphanFiles.push(...group.files);
      }
    }

    // If we have orphan files, create an "Other" group
    if (orphanFiles.length > 0) {
      filtered.push({
        id: 'other',
        label: `📦 Other (${orphanFiles.length})`,
        description: 'Files not meeting minimum group size',
        icon: 'archive',
        files: orphanFiles
      });
    }

    return filtered;
  }

  /**
   * Calculate aggregate metadata for a group
   */
  private calculateGroupMetadata(
    files: vscode.Uri[],
    metadata: Map<string, FileMetadata>
  ): GroupNode['metadata'] {
    let totalTokens = 0;
    let totalSize = 0;
    let totalScore = 0;
    let scoreCount = 0;

    for (const file of files) {
      const meta = metadata.get(file.fsPath);
      if (meta) {
        totalTokens += meta.tokens || 0;
        totalSize += meta.size || 0;
        if (meta.score !== undefined) {
          totalScore += meta.score;
          scoreCount++;
        }
      }
    }

    return {
      totalTokens,
      totalSize,
      averageScore: scoreCount > 0 ? totalScore / scoreCount : undefined,
      fileCount: files.length
    };
  }

  /**
   * Get user-friendly label for file type
   */
  private getFileTypeLabel(ext: string): string {
    const labels: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript React',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript React',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.c': 'C',
      '.cpp': 'C++',
      '.h': 'C Header',
      '.hpp': 'C++ Header',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.md': 'Markdown',
      '.json': 'JSON',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.xml': 'XML',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.less': 'LESS'
    };

    return labels[ext] || ext.substring(1).toUpperCase();
  }

  /**
   * Get icon for file type
   */
  private getFileTypeIcon(ext: string): string {
    const icons: Record<string, string> = {
      '.ts': '⚡',
      '.tsx': '⚛️',
      '.js': '📜',
      '.jsx': '⚛️',
      '.py': '🐍',
      '.java': '☕',
      '.go': '🔷',
      '.rs': '🦀',
      '.c': '🔧',
      '.cpp': '⚙️',
      '.cs': '#️⃣',
      '.rb': '💎',
      '.php': '🐘',
      '.swift': '🐦',
      '.kt': '🎯',
      '.md': '📝',
      '.json': '📋',
      '.yaml': '⚙️',
      '.yml': '⚙️',
      '.xml': '📄',
      '.html': '🌐',
      '.css': '🎨'
    };

    return icons[ext] || '📄';
  }

  /**
   * Get label for git status
   */
  private getGitStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      modified: '✏️ Modified',
      added: '➕ Added',
      deleted: '🗑️ Deleted',
      untracked: '❓ Untracked',
      staged: '✅ Staged',
      clean: '✨ Clean'
    };

    return labels[status] || status;
  }

  /**
   * Get icon for git status
   */
  private getGitStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      modified: 'edit',
      added: 'add',
      deleted: 'trash',
      untracked: 'question',
      staged: 'check',
      clean: 'pass'
    };

    return icons[status] || 'file';
  }

  /**
   * Show grouping strategy selector UI
   */
  async showGroupingSelector(currentStrategy: GroupingStrategy): Promise<GroupingOptions | undefined> {
    const items = [
      {
        label: '$(list-flat) No Grouping',
        description: 'Flat list of all files',
        strategy: 'none' as const,
        picked: currentStrategy === 'none'
      },
      {
        label: '$(folder) Group by Directory',
        description: 'Organize by folder structure',
        strategy: 'directory' as const,
        picked: currentStrategy === 'directory'
      },
      {
        label: '$(symbol-file) Group by File Type',
        description: 'Organize by file extension',
        strategy: 'file-type' as const,
        picked: currentStrategy === 'file-type'
      },
      {
        label: '$(git-branch) Group by Git Status',
        description: 'Organize by modification status',
        strategy: 'git-status' as const,
        picked: currentStrategy === 'git-status'
      },
      {
        label: '$(database) Group by Size',
        description: 'Organize by file size',
        strategy: 'size' as const,
        picked: currentStrategy === 'size'
      },
      {
        label: '$(symbol-numeric) Group by Tokens',
        description: 'Organize by token count',
        strategy: 'tokens' as const,
        picked: currentStrategy === 'tokens'
      },
      {
        label: '$(history) Group by Recency',
        description: 'Organize by modification date',
        strategy: 'recency' as const,
        picked: currentStrategy === 'recency'
      },
      {
        label: '$(link) Group by Relationships',
        description: 'Organize by connection strength',
        strategy: 'relationship' as const,
        picked: currentStrategy === 'relationship'
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select grouping strategy',
      matchOnDescription: true
    });

    if (!selected) {
      return undefined;
    }

    // Additional options based on strategy
    let options: GroupingOptions = {
      strategy: selected.strategy,
      sortWithinGroups: 'name',
      collapsible: true
    };

    if (selected.strategy === 'directory') {
      const depthInput = await vscode.window.showInputBox({
        prompt: 'Maximum directory depth (1-5)',
        value: '2',
        validateInput: (value) => {
          const num = parseInt(value);
          if (isNaN(num) || num < 1 || num > 5) {
            return 'Please enter a number between 1 and 5';
          }
          return null;
        }
      });

      if (depthInput) {
        options.maxDepth = parseInt(depthInput);
      }
    }

    // Ask for sorting preference
    const sortOptions = [
      { label: '$(sort-precedence) Sort by Name', sort: 'name' as const },
      { label: '$(database) Sort by Size', sort: 'size' as const },
      { label: '$(symbol-numeric) Sort by Tokens', sort: 'tokens' as const },
      { label: '$(star-full) Sort by Score', sort: 'score' as const }
    ];

    const sortSelected = await vscode.window.showQuickPick(sortOptions, {
      placeHolder: 'Sort files within groups'
    });

    if (sortSelected) {
      options.sortWithinGroups = sortSelected.sort;
    }

    return options;
  }

  /**
   * Get grouping statistics
   */
  getGroupingStats(groups: GroupNode[]): {
    totalGroups: number;
    totalFiles: number;
    averageFilesPerGroup: number;
    largestGroup: GroupNode | undefined;
    smallestGroup: GroupNode | undefined;
  } {
    if (groups.length === 0) {
      return {
        totalGroups: 0,
        totalFiles: 0,
        averageFilesPerGroup: 0,
        largestGroup: undefined,
        smallestGroup: undefined
      };
    }

    const totalFiles = groups.reduce((sum, group) => sum + group.files.length, 0);
    const averageFilesPerGroup = totalFiles / groups.length;

    const sortedBySize = [...groups].sort((a, b) => b.files.length - a.files.length);
    const largestGroup = sortedBySize[0];
    const smallestGroup = sortedBySize[sortedBySize.length - 1];

    return {
      totalGroups: groups.length,
      totalFiles,
      averageFilesPerGroup,
      largestGroup,
      smallestGroup
    };
  }

  dispose(): void {
    // Cleanup if needed
  }
}

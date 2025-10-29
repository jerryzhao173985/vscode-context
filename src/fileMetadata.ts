import * as vscode from 'vscode';
import { GitContextProvider } from './gitContext';
import * as path from 'path';

/**
 * Blame information for a single line
 */
export interface BlameLineInfo {
  line: number;
  author: string;
  email: string;
  date: Date;
  commitHash: string;
  commitMessage: string;
}

/**
 * Comprehensive file metadata
 */
export interface FileMetadata {
  uri: vscode.Uri;

  // Git metadata
  lastModifiedBy?: string;      // Git author of last commit
  lastModifiedAt?: Date;        // Git commit date
  commitHash?: string;          // Last commit hash
  commitMessage?: string;       // Last commit message
  blameInfo?: BlameLineInfo[];  // Per-line blame (expensive)

  // File system metadata
  createdAt?: Date;
  modifiedAt?: Date;
  size: number;

  // Code metrics
  linesOfCode: number;
  complexity?: number;

  // Ownership
  primaryAuthor?: string;       // Most commits
  contributors?: string[];      // All contributors
  lastTouchDaysAgo?: number;    // Staleness indicator

  // Additional context
  language?: string;
  extension: string;
}

/**
 * Author contribution statistics
 */
export interface AuthorContribution {
  author: string;
  email: string;
  commits: number;
  lines: number;
  percentage: number;
}

/**
 * File Metadata Provider
 * Provides comprehensive metadata about files
 */
export class FileMetadataProvider {
  private metadataCache: Map<string, FileMetadata> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes
  private cacheTimestamps: Map<string, number> = new Map();

  constructor(
    private gitProvider: GitContextProvider | undefined
  ) {}

  /**
   * Get metadata for a file
   */
  async getMetadata(uri: vscode.Uri, includeBlame: boolean = false): Promise<FileMetadata> {
    const cacheKey = uri.fsPath;

    // Check cache
    if (this.isCached(cacheKey)) {
      const cached = this.metadataCache.get(cacheKey);

      // Handle race condition where cache was cleared
      if (!cached) {
        return this.fetchMetadata(uri, includeBlame);
      }

      // If blame not cached but requested, fetch it
      if (includeBlame && !cached.blameInfo) {
        const blameInfo = await this.getBlame(uri);
        // Create new object to avoid mutating cached reference
        const updated = { ...cached, blameInfo };
        this.metadataCache.set(cacheKey, updated);
        return updated;
      }

      return cached;
    }

    // Fetch fresh metadata
    const metadata = await this.fetchMetadata(uri, includeBlame);

    // Cache it
    this.metadataCache.set(cacheKey, metadata);
    this.cacheTimestamps.set(cacheKey, Date.now());

    return metadata;
  }

  /**
   * Get blame information for a file
   */
  async getBlame(uri: vscode.Uri): Promise<BlameLineInfo[]> {
    if (!this.gitProvider || !this.gitProvider.isAvailable()) {
      return [];
    }

    try {
      // TODO: Implement git blame parsing
      // Would need to run: git blame --line-porcelain <file>
      // const document = await vscode.workspace.openTextDocument(uri);
      // const lines = document.getText().split('\n');
      // ... parse git blame output and map to lines ...

      return [];
    } catch (error) {
      console.error('Error getting blame:', error);
      return [];
    }
  }

  /**
   * Get author contributions for a file
   */
  async getContributions(uri: vscode.Uri): Promise<AuthorContribution[]> {
    if (!this.gitProvider || !this.gitProvider.isAvailable()) {
      return [];
    }

    // TODO: Implement git shortlog parsing
    // git shortlog -sne <file>
    return [];
  }

  /**
   * Format metadata for display in tooltip
   */
  formatTooltip(metadata: FileMetadata): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();

    tooltip.appendMarkdown(`**${path.basename(metadata.uri.fsPath)}**\n\n`);

    // File info
    tooltip.appendMarkdown(`📄 **File Info**\n`);
    tooltip.appendMarkdown(`- Size: ${this.formatSize(metadata.size)}\n`);
    tooltip.appendMarkdown(`- Lines: ${metadata.linesOfCode.toLocaleString()}\n`);
    tooltip.appendMarkdown(`- Language: ${metadata.language || 'Unknown'}\n`);

    tooltip.appendMarkdown('\n');

    // Git info
    if (metadata.lastModifiedBy) {
      tooltip.appendMarkdown(`📝 **Last Modified**\n`);
      tooltip.appendMarkdown(`- Author: ${metadata.lastModifiedBy}\n`);

      if (metadata.lastModifiedAt) {
        const daysAgo = metadata.lastTouchDaysAgo || 0;
        tooltip.appendMarkdown(`- When: ${this.formatTimeAgo(daysAgo)}\n`);
      }

      if (metadata.commitMessage) {
        const shortMessage = metadata.commitMessage.split('\n')[0];
        tooltip.appendMarkdown(`- Commit: "${shortMessage.substring(0, 50)}${shortMessage.length > 50 ? '...' : ''}"\n`);
      }
    }

    tooltip.appendMarkdown('\n');

    // Ownership
    if (metadata.primaryAuthor) {
      tooltip.appendMarkdown(`👤 **Ownership**\n`);
      tooltip.appendMarkdown(`- Primary: ${metadata.primaryAuthor}\n`);

      if (metadata.contributors && metadata.contributors.length > 0) {
        tooltip.appendMarkdown(`- Contributors: ${metadata.contributors.length}\n`);
      }
    }

    return tooltip;
  }

  /**
   * Format metadata for output in context
   */
  formatForOutput(metadata: FileMetadata): string {
    const relativePath = vscode.workspace.asRelativePath(metadata.uri);
    let output = `## ${relativePath}\n\n`;

    // File info
    output += `**File Info:**\n`;
    output += `- Size: ${this.formatSize(metadata.size)}\n`;
    output += `- Lines: ${metadata.linesOfCode.toLocaleString()}\n`;
    output += `- Language: ${metadata.language || 'Unknown'}\n`;

    // Git info
    if (metadata.lastModifiedBy) {
      output += `\n**Last Modified:**\n`;
      output += `- Author: ${metadata.lastModifiedBy}\n`;

      if (metadata.lastModifiedAt) {
        output += `- Date: ${metadata.lastModifiedAt.toLocaleDateString()}\n`;
        output += `- Days Ago: ${metadata.lastTouchDaysAgo || 0}\n`;
      }

      if (metadata.commitMessage) {
        output += `- Commit: "${metadata.commitMessage.split('\n')[0]}"\n`;
      }

      if (metadata.commitHash) {
        output += `- Hash: \`${metadata.commitHash.substring(0, 7)}\`\n`;
      }
    }

    // Ownership
    if (metadata.primaryAuthor) {
      output += `\n**Ownership:**\n`;
      output += `- Primary Author: ${metadata.primaryAuthor}\n`;

      if (metadata.contributors && metadata.contributors.length > 0) {
        output += `- Contributors: ${metadata.contributors.join(', ')}\n`;
      }
    }

    return output + '\n';
  }

  /**
   * Batch get metadata for multiple files
   */
  async getBatchMetadata(
    uris: vscode.Uri[],
    includeBlame: boolean = false
  ): Promise<Map<string, FileMetadata>> {
    const results = new Map<string, FileMetadata>();

    // Use Promise.all for parallel fetching
    const metadataPromises = uris.map(async (uri) => {
      const metadata = await this.getMetadata(uri, includeBlame);
      results.set(uri.fsPath, metadata);
    });

    await Promise.all(metadataPromises);

    return results;
  }

  /**
   * Get aggregate statistics for multiple files
   */
  async getAggregateStats(uris: vscode.Uri[]): Promise<{
    totalSize: number;
    totalLines: number;
    fileCount: number;
    byAuthor: Map<string, number>;
    byLanguage: Map<string, number>;
    averageAge: number;
    oldestFile?: FileMetadata;
    newestFile?: FileMetadata;
  }> {
    const metadata = await this.getBatchMetadata(uris, false);

    let totalSize = 0;
    let totalLines = 0;
    let totalAge = 0;
    let ageCount = 0;
    const byAuthor = new Map<string, number>();
    const byLanguage = new Map<string, number>();
    let oldestFile: FileMetadata | undefined;
    let newestFile: FileMetadata | undefined;

    for (const meta of metadata.values()) {
      totalSize += meta.size;
      totalLines += meta.linesOfCode;

      if (meta.lastTouchDaysAgo !== undefined) {
        totalAge += meta.lastTouchDaysAgo;
        ageCount++;

        if (!oldestFile || meta.lastTouchDaysAgo > (oldestFile.lastTouchDaysAgo || 0)) {
          oldestFile = meta;
        }

        if (!newestFile || meta.lastTouchDaysAgo < (newestFile.lastTouchDaysAgo || 0)) {
          newestFile = meta;
        }
      }

      if (meta.lastModifiedBy) {
        byAuthor.set(meta.lastModifiedBy, (byAuthor.get(meta.lastModifiedBy) || 0) + 1);
      }

      if (meta.language) {
        byLanguage.set(meta.language, (byLanguage.get(meta.language) || 0) + 1);
      }
    }

    return {
      totalSize,
      totalLines,
      fileCount: metadata.size,
      byAuthor,
      byLanguage,
      averageAge: ageCount > 0 ? totalAge / ageCount : 0,
      oldestFile,
      newestFile
    };
  }

  /**
   * Invalidate cache for a file
   */
  invalidateCache(uri: vscode.Uri): void {
    const cacheKey = uri.fsPath;
    this.metadataCache.delete(cacheKey);
    this.cacheTimestamps.delete(cacheKey);
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.metadataCache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * Fetch metadata from file system and git
   */
  private async fetchMetadata(uri: vscode.Uri, includeBlame: boolean): Promise<FileMetadata> {
    const metadata: FileMetadata = {
      uri,
      size: 0,
      linesOfCode: 0,
      extension: path.extname(uri.fsPath)
    };

    try {
      // File system metadata
      const stat = await vscode.workspace.fs.stat(uri);
      metadata.size = stat.size;
      metadata.createdAt = new Date(stat.ctime);
      metadata.modifiedAt = new Date(stat.mtime);

      // Document metadata
      const document = await vscode.workspace.openTextDocument(uri);
      metadata.linesOfCode = document.lineCount;
      metadata.language = document.languageId;

      // Git metadata (if available)
      if (this.gitProvider && this.gitProvider.isAvailable()) {
        // TODO: Get git metadata
        // Would need to execute git commands:
        // - git log -1 --format="%an|%ae|%ad|%h|%s" <file>
        // - git shortlog -sne <file> (for contributors)

        // Calculate staleness
        if (metadata.modifiedAt) {
          const now = Date.now();
          const diff = now - metadata.modifiedAt.getTime();
          metadata.lastTouchDaysAgo = Math.floor(diff / (24 * 60 * 60 * 1000));
        }
      }

      // Blame info (if requested and git available)
      if (includeBlame && this.gitProvider && this.gitProvider.isAvailable()) {
        metadata.blameInfo = await this.getBlame(uri);
      }

    } catch (error) {
      console.error(`Error fetching metadata for ${uri.fsPath}:`, error);
    }

    return metadata;
  }

  /**
   * Check if cache entry is still valid
   */
  private isCached(cacheKey: string): boolean {
    if (!this.metadataCache.has(cacheKey)) {
      return false;
    }

    const timestamp = this.cacheTimestamps.get(cacheKey);
    if (!timestamp) {
      return false;
    }

    const age = Date.now() - timestamp;
    return age < this.cacheTTL;
  }

  /**
   * Format file size
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
  }

  /**
   * Format time ago
   */
  private formatTimeAgo(days: number): string {
    if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    } else if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months > 1 ? 's' : ''} ago`;
    } else {
      const years = Math.floor(days / 365);
      return `${years} year${years > 1 ? 's' : ''} ago`;
    }
  }

  dispose(): void {
    this.clearCache();
  }
}

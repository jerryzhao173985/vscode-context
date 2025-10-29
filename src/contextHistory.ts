import * as vscode from 'vscode';

export interface ContextSnapshot {
  id: string;
  timestamp: number;
  files: string[]; // file paths
  mode?: string;
  metadata: {
    totalTokens?: number;
    fileCount: number;
    description?: string;
    taskType?: string;
    trigger?: 'manual' | 'auto' | 'preset';
  };
}

export interface ContextDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

export class ContextHistoryTracker {
  private history: ContextSnapshot[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 50;
  private autoSaveEnabled: boolean = true;
  private readonly STORAGE_KEY = 'contextPack.history';

  constructor(private context: vscode.ExtensionContext) {
    this.loadHistory();
  }

  /**
   * Load history from storage
   */
  private loadHistory(): void {
    const stored = this.context.globalState.get<ContextSnapshot[]>(this.STORAGE_KEY, []);
    this.history = stored;
    this.currentIndex = this.history.length - 1;
  }

  /**
   * Save history to storage
   */
  private async saveHistory(): Promise<void> {
    // Keep only the most recent snapshots
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
      this.currentIndex = this.history.length - 1;
    }

    await this.context.globalState.update(this.STORAGE_KEY, this.history);
  }

  /**
   * Create a new snapshot
   */
  async createSnapshot(
    files: vscode.Uri[],
    options?: {
      description?: string;
      mode?: string;
      taskType?: string;
      totalTokens?: number;
      trigger?: 'manual' | 'auto' | 'preset';
    }
  ): Promise<ContextSnapshot> {
    const snapshot: ContextSnapshot = {
      id: this.generateId(),
      timestamp: Date.now(),
      files: files.map(uri => uri.fsPath),
      mode: options?.mode,
      metadata: {
        fileCount: files.length,
        description: options?.description,
        taskType: options?.taskType,
        totalTokens: options?.totalTokens,
        trigger: options?.trigger || 'manual'
      }
    };

    // If we're not at the end of history, remove everything after current
    if (this.currentIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.currentIndex + 1);
    }

    this.history.push(snapshot);
    this.currentIndex = this.history.length - 1;

    await this.saveHistory();

    return snapshot;
  }

  /**
   * Auto-save snapshot if enabled
   */
  async autoSave(
    files: vscode.Uri[],
    options?: {
      mode?: string;
      totalTokens?: number;
    }
  ): Promise<void> {
    if (!this.autoSaveEnabled) {
      return;
    }

    // Only auto-save if selection has changed
    const lastSnapshot = this.getCurrentSnapshot();
    if (lastSnapshot && this.areSnapshotsEqual(lastSnapshot.files, files.map(u => u.fsPath))) {
      return;
    }

    await this.createSnapshot(files, {
      ...options,
      trigger: 'auto'
    });
  }

  /**
   * Get current snapshot
   */
  getCurrentSnapshot(): ContextSnapshot | undefined {
    return this.history[this.currentIndex];
  }

  /**
   * Get all snapshots
   */
  getAllSnapshots(): ContextSnapshot[] {
    return [...this.history].reverse(); // Most recent first
  }

  /**
   * Navigate to previous snapshot (undo)
   */
  async goToPrevious(): Promise<ContextSnapshot | undefined> {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.history[this.currentIndex];
    }
    return undefined;
  }

  /**
   * Navigate to next snapshot (redo)
   */
  async goToNext(): Promise<ContextSnapshot | undefined> {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      return this.history[this.currentIndex];
    }
    return undefined;
  }

  /**
   * Go to specific snapshot
   */
  async goToSnapshot(id: string): Promise<ContextSnapshot | undefined> {
    const index = this.history.findIndex(s => s.id === id);
    if (index >= 0) {
      this.currentIndex = index;
      return this.history[index];
    }
    return undefined;
  }

  /**
   * Can undo?
   */
  canUndo(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * Can redo?
   */
  canRedo(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  /**
   * Compare two snapshots
   */
  diffSnapshots(snapshot1: ContextSnapshot, snapshot2: ContextSnapshot): ContextDiff {
    const files1 = new Set(snapshot1.files);
    const files2 = new Set(snapshot2.files);

    const added: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    for (const file of files2) {
      if (files1.has(file)) {
        unchanged.push(file);
      } else {
        added.push(file);
      }
    }

    for (const file of files1) {
      if (!files2.has(file)) {
        removed.push(file);
      }
    }

    return { added, removed, unchanged };
  }

  /**
   * Show history UI
   */
  async showHistoryUI(): Promise<ContextSnapshot | undefined> {
    if (this.history.length === 0) {
      vscode.window.showInformationMessage('No history available');
      return undefined;
    }

    const items = this.getAllSnapshots().map((snapshot, index) => {
      const actualIndex = this.history.length - 1 - index;
      const isCurrent = actualIndex === this.currentIndex;
      const timeAgo = this.formatTimeAgo(snapshot.timestamp);

      return {
        label: `${isCurrent ? '$(arrow-right) ' : ''}${snapshot.metadata.description || 'Context'} ${snapshot.metadata.trigger === 'auto' ? '(auto)' : ''}`,
        description: `${snapshot.metadata.fileCount} files • ${timeAgo}`,
        detail: snapshot.metadata.totalTokens
          ? `${snapshot.metadata.totalTokens.toLocaleString()} tokens`
          : undefined,
        snapshot,
        buttons: isCurrent ? [] : [
          {
            iconPath: new vscode.ThemeIcon('compare-changes'),
            tooltip: 'Compare with current'
          }
        ]
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a snapshot to restore',
      matchOnDescription: true,
      matchOnDetail: true
    });

    return selected?.snapshot;
  }

  /**
   * Show diff UI
   */
  async showDiffUI(snapshot1: ContextSnapshot, snapshot2: ContextSnapshot): Promise<void> {
    const diff = this.diffSnapshots(snapshot1, snapshot2);

    const output: string[] = [];
    output.push('# Context Diff\n');
    output.push(`From: ${this.formatDate(snapshot1.timestamp)} (${snapshot1.metadata.fileCount} files)`);
    output.push(`To: ${this.formatDate(snapshot2.timestamp)} (${snapshot2.metadata.fileCount} files)\n`);

    if (diff.added.length > 0) {
      output.push(`## ✅ Added Files (${diff.added.length})\n`);
      diff.added.forEach(file => {
        const relativePath = vscode.workspace.asRelativePath(file);
        output.push(`+ ${relativePath}`);
      });
      output.push('');
    }

    if (diff.removed.length > 0) {
      output.push(`## ❌ Removed Files (${diff.removed.length})\n`);
      diff.removed.forEach(file => {
        const relativePath = vscode.workspace.asRelativePath(file);
        output.push(`- ${relativePath}`);
      });
      output.push('');
    }

    if (diff.unchanged.length > 0) {
      output.push(`## ⚪ Unchanged Files (${diff.unchanged.length})\n`);
      diff.unchanged.slice(0, 10).forEach(file => {
        const relativePath = vscode.workspace.asRelativePath(file);
        output.push(`  ${relativePath}`);
      });
      if (diff.unchanged.length > 10) {
        output.push(`  ... and ${diff.unchanged.length - 10} more`);
      }
    }

    const doc = await vscode.workspace.openTextDocument({
      content: output.join('\n'),
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Compare with current
   */
  async compareWithCurrent(snapshot: ContextSnapshot, currentFiles: vscode.Uri[]): Promise<void> {
    const currentSnapshot: ContextSnapshot = {
      id: 'current',
      timestamp: Date.now(),
      files: currentFiles.map(uri => uri.fsPath),
      metadata: {
        fileCount: currentFiles.length,
        description: 'Current selection'
      }
    };

    await this.showDiffUI(snapshot, currentSnapshot);
  }

  /**
   * Clear history
   */
  async clearHistory(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Clear all context history?',
      { modal: true },
      'Clear History'
    );

    if (confirm === 'Clear History') {
      this.history = [];
      this.currentIndex = -1;
      await this.saveHistory();
      vscode.window.showInformationMessage('History cleared');
    }
  }

  /**
   * Set auto-save enabled
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  /**
   * Is auto-save enabled?
   */
  isAutoSaveEnabled(): boolean {
    return this.autoSaveEnabled;
  }

  /**
   * Get history statistics
   */
  getStatistics(): {
    totalSnapshots: number;
    oldestSnapshot?: Date;
    newestSnapshot?: Date;
    averageFilesPerSnapshot: number;
    mostCommonFileCount: number;
  } {
    if (this.history.length === 0) {
      return {
        totalSnapshots: 0,
        averageFilesPerSnapshot: 0,
        mostCommonFileCount: 0
      };
    }

    const timestamps = this.history.map(s => s.timestamp);
    const fileCounts = this.history.map(s => s.metadata.fileCount);

    const totalFiles = fileCounts.reduce((sum, count) => sum + count, 0);
    const averageFilesPerSnapshot = totalFiles / this.history.length;

    // Find most common file count
    const countMap = new Map<number, number>();
    for (const count of fileCounts) {
      countMap.set(count, (countMap.get(count) || 0) + 1);
    }
    const mostCommonFileCount = Array.from(countMap.entries())
      .sort((a, b) => b[1] - a[1])[0][0];

    return {
      totalSnapshots: this.history.length,
      oldestSnapshot: new Date(Math.min(...timestamps)),
      newestSnapshot: new Date(Math.max(...timestamps)),
      averageFilesPerSnapshot,
      mostCommonFileCount
    };
  }

  /**
   * Export history
   */
  exportHistory(): string {
    return JSON.stringify(this.history, null, 2);
  }

  /**
   * Import history
   */
  async importHistory(json: string): Promise<number> {
    try {
      const imported = JSON.parse(json) as ContextSnapshot[];

      // Add to existing history
      for (const snapshot of imported) {
        this.history.push({
          ...snapshot,
          id: this.generateId() // Generate new ID
        });
      }

      this.currentIndex = this.history.length - 1;
      await this.saveHistory();

      return imported.length;
    } catch (error) {
      throw new Error('Invalid history data');
    }
  }

  /**
   * Helper: Check if two snapshot file lists are equal
   */
  private areSnapshotsEqual(files1: string[], files2: string[]): boolean {
    if (files1.length !== files2.length) {
      return false;
    }

    const set1 = new Set(files1);
    return files2.every(file => set1.has(file));
  }

  /**
   * Helper: Format time ago
   */
  private formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return this.formatDate(timestamp);
  }

  /**
   * Helper: Format date
   */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  /**
   * Helper: Generate unique ID
   */
  private generateId(): string {
    return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  dispose(): void {
    this.history = [];
  }
}

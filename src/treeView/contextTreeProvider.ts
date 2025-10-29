import * as vscode from 'vscode';
import * as path from 'path';
import { ContextTreeItem, ItemType, FileStatus } from './contextTreeItem';
import { GitContextProvider } from '../gitContext';
import { TokenCounter } from '../tokenCounter';
import { FileRelationshipAnalyzer } from '../fileRelationships';
import { SmartFileSelector } from '../smartFileSelection';
import { PerformanceMonitor } from '../performanceMonitor';

export type SortOrder = 'score' | 'name' | 'size' | 'tokens' | 'recent';
export type FilterType = 'all' | 'selected' | 'errors' | 'modified';

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ContextTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootItems: ContextTreeItem[] = [];
  private selectedFiles: Set<string> = new Set();
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private currentMode: 'git-changes' | 'current-task' | 'error-focus' | 'full-project' = 'git-changes';
  private currentSortOrder: SortOrder = 'score';
  private currentFilter: FilterType = 'all';
  private searchQuery: string = '';
  private showSmartSuggestions: boolean = true;

  constructor(
    private context: vscode.ExtensionContext,
    private gitProvider: GitContextProvider | undefined,
    private tokenCounter: TokenCounter,
    private relationshipAnalyzer: FileRelationshipAnalyzer,
    private smartSelector: SmartFileSelector,
    private performanceMonitor: PerformanceMonitor
  ) {
    // Setup file watcher
    this.setupFileWatcher();

    // Restore previous state
    this.restoreState();

    // Setup checkbox change handler
    vscode.window.registerTreeDataProvider('contextPackExplorer', this);
  }

  private setupFileWatcher(): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceFolder, '**/*')
    );

    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidChange(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());

    this.context.subscriptions.push(this.fileWatcher);
  }

  getTreeItem(element: ContextTreeItem): vscode.TreeItem {
    element.updateTooltip();
    return element;
  }

  async getChildren(element?: ContextTreeItem): Promise<ContextTreeItem[]> {
    if (!element) {
      // Root level
      return this.getRootItems();
    }

    // Return children of element
    return element.children;
  }

  private async getRootItems(): Promise<ContextTreeItem[]> {
    this.performanceMonitor.start('getRootItems');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      this.performanceMonitor.end('getRootItems');
      return [];
    }

    const items: ContextTreeItem[] = [];

    // Add summary at top
    const summary = this.createSummaryItem();
    if (summary) {
      items.push(summary);
    }

    // Add smart suggestions section if enabled
    if (this.showSmartSuggestions && this.selectedFiles.size > 0) {
      const suggestions = await this.getSmartSuggestionsItems();
      if (suggestions.length > 0) {
        items.push(...suggestions);
      }
    }

    // Add items based on current mode
    switch (this.currentMode) {
      case 'git-changes':
        items.push(...(await this.getGitChangesItems()));
        break;
      case 'current-task':
        items.push(...(await this.getCurrentTaskItems()));
        break;
      case 'error-focus':
        items.push(...(await this.getErrorFocusItems()));
        break;
      case 'full-project':
        items.push(...(await this.getFullProjectItems()));
        break;
    }

    // Apply filtering
    const filteredItems = this.applyFilter(items);

    // Apply search
    const searchedItems = this.applySearch(filteredItems);

    this.rootItems = searchedItems;
    this.performanceMonitor.end('getRootItems');
    return searchedItems;
  }

  private createSummaryItem(): ContextTreeItem | null {
    const selectedCount = this.selectedFiles.size;
    if (selectedCount === 0) {
      return null;
    }

    // Calculate total tokens and cost
    let totalTokens = 0;
    this.rootItems.forEach(item => {
      if (item.checked && item.tokens > 0) {
        totalTokens += item.tokens;
      }
    });

    // Rough cost estimate for GPT-4o: $2.50 per 1M tokens
    const estimatedCost = (totalTokens / 1000000) * 2.50;

    return ContextTreeItem.createSummary(selectedCount, totalTokens, estimatedCost);
  }

  private async getGitChangesItems(): Promise<ContextTreeItem[]> {
    if (!this.gitProvider || !this.gitProvider.isAvailable()) {
      return this.getEmptyStateItem('No Git repository found');
    }

    const modifiedFiles = await this.gitProvider.getModifiedFiles();
    if (modifiedFiles.length === 0) {
      return this.getEmptyStateItem('No git changes found');
    }

    const items: ContextTreeItem[] = [];

    // Group by status
    const grouped = new Map<string, vscode.Uri[]>();
    for (const file of modifiedFiles) {
      if (!grouped.has(file.status)) {
        grouped.set(file.status, []);
      }
      grouped.get(file.status)!.push(file.uri);
    }

    // Create categories
    for (const [status, files] of grouped.entries()) {
      const category = ContextTreeItem.createCategory(
        `${this.getStatusLabel(status)} (${files.length})`,
        this.getStatusIcon(status)
      );

      // Add files
      for (const uri of files) {
        const fileItem = new ContextTreeItem(
          uri,
          path.basename(uri.fsPath),
          ItemType.File,
          vscode.TreeItemCollapsibleState.None
        );

        fileItem.updateFileStatus(this.mapGitStatus(status));

        // Restore checked state
        if (this.selectedFiles.has(uri.fsPath)) {
          fileItem.checked = true;
        }

        category.children.push(fileItem);
      }

      items.push(category);
    }

    return items;
  }

  private async getCurrentTaskItems(): Promise<ContextTreeItem[]> {
    // Get currently open editors
    const openEditors = vscode.window.visibleTextEditors;
    if (openEditors.length === 0) {
      return this.getEmptyStateItem('No files currently open');
    }

    const items: ContextTreeItem[] = [];
    const category = ContextTreeItem.createCategory(
      `Open Files (${openEditors.length})`,
      'files'
    );

    for (const editor of openEditors) {
      const uri = editor.document.uri;
      const fileItem = new ContextTreeItem(
        uri,
        path.basename(uri.fsPath),
        ItemType.File,
        vscode.TreeItemCollapsibleState.None
      );

      // Restore checked state
      if (this.selectedFiles.has(uri.fsPath)) {
        fileItem.checked = true;
      }

      category.children.push(fileItem);
    }

    items.push(category);

    // Add related files if enabled
    const config = vscode.workspace.getConfiguration('copyContext');
    if (config.get<boolean>('autoIncludeRelated', true)) {
      const relatedItems = await this.getRelatedFilesItems();
      items.push(...relatedItems);
    }

    return items;
  }

  private async getErrorFocusItems(): Promise<ContextTreeItem[]> {
    const diagnostics = vscode.languages.getDiagnostics();
    if (diagnostics.length === 0) {
      return this.getEmptyStateItem('No errors or warnings found');
    }

    const items: ContextTreeItem[] = [];

    // Group by severity
    const errors: vscode.Uri[] = [];
    const warnings: vscode.Uri[] = [];

    for (const [uri, diags] of diagnostics) {
      const hasError = diags.some(d => d.severity === vscode.DiagnosticSeverity.Error);
      const hasWarning = diags.some(d => d.severity === vscode.DiagnosticSeverity.Warning);

      if (hasError) {
        errors.push(uri);
      } else if (hasWarning) {
        warnings.push(uri);
      }
    }

    // Add error files
    if (errors.length > 0) {
      const errorCategory = ContextTreeItem.createCategory(
        `Errors (${errors.length})`,
        'error'
      );

      for (const uri of errors) {
        const fileItem = new ContextTreeItem(
          uri,
          path.basename(uri.fsPath),
          ItemType.File,
          vscode.TreeItemCollapsibleState.None
        );

        if (this.selectedFiles.has(uri.fsPath)) {
          fileItem.checked = true;
        }

        errorCategory.children.push(fileItem);
      }

      items.push(errorCategory);
    }

    // Add warning files
    if (warnings.length > 0) {
      const warningCategory = ContextTreeItem.createCategory(
        `Warnings (${warnings.length})`,
        'warning'
      );

      for (const uri of warnings) {
        const fileItem = new ContextTreeItem(
          uri,
          path.basename(uri.fsPath),
          ItemType.File,
          vscode.TreeItemCollapsibleState.None
        );

        if (this.selectedFiles.has(uri.fsPath)) {
          fileItem.checked = true;
        }

        warningCategory.children.push(fileItem);
      }

      items.push(warningCategory);
    }

    return items;
  }

  private async getFullProjectItems(): Promise<ContextTreeItem[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    // Get all source files
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,java,go,rs,c,cpp,h,hpp}',
      '**/node_modules/**'
    );

    if (files.length === 0) {
      return this.getEmptyStateItem('No source files found');
    }

    const items: ContextTreeItem[] = [];
    const category = ContextTreeItem.createCategory(
      `Project Files (${files.length})`,
      'folder-library'
    );

    // Limit to prevent performance issues
    const maxFiles = 100;
    const filesToShow = files.slice(0, maxFiles);

    for (const uri of filesToShow) {
      const fileItem = new ContextTreeItem(
        uri,
        path.basename(uri.fsPath),
        ItemType.File,
        vscode.TreeItemCollapsibleState.None
      );

      if (this.selectedFiles.has(uri.fsPath)) {
        fileItem.checked = true;
      }

      category.children.push(fileItem);
    }

    if (files.length > maxFiles) {
      const moreItem = new ContextTreeItem(
        undefined,
        `... and ${files.length - maxFiles} more files`,
        ItemType.Summary,
        vscode.TreeItemCollapsibleState.None
      );
      category.children.push(moreItem);
    }

    items.push(category);
    return items;
  }

  private async getRelatedFilesItems(): Promise<ContextTreeItem[]> {
    // Get related files for currently selected files
    const config = vscode.workspace.getConfiguration('copyContext');
    const relationshipTypes = config.get<string[]>('relationshipTypes', ['imports', 'tests', 'types']);
    const maxRelatedFiles = config.get<number>('maxRelatedFiles', 5);
    const confidenceThreshold = config.get<number>('confidenceThreshold', 0.6);

    const selectedUris = Array.from(this.selectedFiles).map(fsPath => vscode.Uri.file(fsPath));
    if (selectedUris.length === 0) {
      return [];
    }

    const allRelated = await this.relationshipAnalyzer.findRelatedFilesForMultiple(
      selectedUris,
      {
        types: relationshipTypes as any,
        maxFiles: maxRelatedFiles,
        confidenceThreshold
      }
    );

    const uniqueRelated = this.relationshipAnalyzer.getUniqueRelatedFiles(allRelated);
    if (uniqueRelated.length === 0) {
      return [];
    }

    const items: ContextTreeItem[] = [];
    const category = ContextTreeItem.createCategory(
      `Related Files (${uniqueRelated.length})`,
      'references'
    );

    for (const uri of uniqueRelated) {
      const fileItem = new ContextTreeItem(
        uri,
        path.basename(uri.fsPath),
        ItemType.File,
        vscode.TreeItemCollapsibleState.None
      );

      // Don't auto-check related files, just suggest them
      category.children.push(fileItem);
    }

    items.push(category);
    return items;
  }

  private getEmptyStateItem(message: string): ContextTreeItem[] {
    const item = new ContextTreeItem(
      undefined,
      message,
      ItemType.Summary,
      vscode.TreeItemCollapsibleState.None
    );
    item.iconPath = new vscode.ThemeIcon('info');
    return [item];
  }

  private getStatusLabel(status: string): string {
    if (status.includes('MODIFIED')) return 'Modified';
    if (status.includes('ADDED')) return 'Added';
    if (status.includes('DELETED')) return 'Deleted';
    if (status.includes('UNTRACKED')) return 'Untracked';
    if (status.includes('staged')) return 'Staged';
    return status;
  }

  private getStatusIcon(status: string): string {
    if (status.includes('MODIFIED')) return 'edit';
    if (status.includes('ADDED')) return 'add';
    if (status.includes('DELETED')) return 'remove';
    if (status.includes('UNTRACKED')) return 'file-add';
    return 'file';
  }

  private mapGitStatus(status: string): FileStatus {
    if (status.includes('MODIFIED')) return FileStatus.Modified;
    if (status.includes('ADDED')) return FileStatus.Added;
    if (status.includes('DELETED')) return FileStatus.Deleted;
    if (status.includes('UNTRACKED')) return FileStatus.Untracked;
    if (status.includes('staged')) return FileStatus.Staged;
    return FileStatus.Clean;
  }

  /**
   * Handle checkbox state changes
   */
  public async handleCheckboxChange(items: ReadonlyArray<readonly [ContextTreeItem, vscode.TreeItemCheckboxState]>): Promise<void> {
    for (const [item, state] of items) {
      const isChecked = state === vscode.TreeItemCheckboxState.Checked;
      item.checked = isChecked;

      if (item.resourceUri) {
        if (isChecked) {
          this.selectedFiles.add(item.resourceUri.fsPath);
        } else {
          this.selectedFiles.delete(item.resourceUri.fsPath);
        }
      }
    }

    this.saveState();
    this.refresh();
  }

  /**
   * Get selected files
   */
  public getSelectedFiles(): vscode.Uri[] {
    return Array.from(this.selectedFiles).map(fsPath => vscode.Uri.file(fsPath));
  }

  /**
   * Set selected files (replaces current selection)
   */
  public async setSelectedFiles(files: vscode.Uri[]): Promise<void> {
    this.selectedFiles.clear();

    for (const file of files) {
      this.selectedFiles.add(file.fsPath);
    }

    this.saveState();
    this.refresh();
  }

  /**
   * Clear all selections
   */
  public clearAll(): void {
    this.selectedFiles.clear();
    this.saveState();
    this.refresh();
  }

  /**
   * Change context mode
   */
  public setMode(mode: 'git-changes' | 'current-task' | 'error-focus' | 'full-project'): void {
    this.currentMode = mode;
    this.refresh();
  }

  /**
   * Refresh the tree
   */
  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get smart suggestions based on current selection
   */
  private async getSmartSuggestionsItems(): Promise<ContextTreeItem[]> {
    const selectedUris = Array.from(this.selectedFiles).map(fsPath => vscode.Uri.file(fsPath));

    const suggestions = await this.smartSelector.getSuggestedFiles(
      selectedUris,
      {
        openEditors: vscode.window.visibleTextEditors.map(e => e.document.uri),
        modifiedFiles: this.gitProvider ? await this.gitProvider.getModifiedFiles().then(files => files.map(f => f.uri)) : [],
        errorFiles: this.getFilesWithErrors()
      },
      5
    );

    if (suggestions.length === 0) {
      return [];
    }

    const items: ContextTreeItem[] = [];
    const category = ContextTreeItem.createCategory(
      `💡 Smart Suggestions (${suggestions.length})`,
      'lightbulb'
    );

    for (const suggestion of suggestions) {
      const fileItem = new ContextTreeItem(
        suggestion.uri,
        path.basename(suggestion.uri.fsPath),
        ItemType.File,
        vscode.TreeItemCollapsibleState.None
      );

      // Add score and reasons to the item
      fileItem.score = suggestion.score;
      fileItem.reasons = suggestion.reasons;

      // Add score and reasons to description
      const scoreIcon = this.getScoreIcon(suggestion.score);
      fileItem.description = `${scoreIcon} ${suggestion.reasons.slice(0, 2).join(' • ')}`;

      // Update tooltip with score info
      fileItem.updateTooltip();

      category.children.push(fileItem);
    }

    items.push(category);
    return items;
  }

  private getScoreIcon(score: number): string {
    if (score > 100) return '⭐⭐⭐';
    if (score > 50) return '⭐⭐';
    if (score > 20) return '⭐';
    return '•';
  }

  private getFilesWithErrors(): vscode.Uri[] {
    const diagnostics = vscode.languages.getDiagnostics();
    const errorFiles: vscode.Uri[] = [];

    for (const [uri, diags] of diagnostics) {
      const hasError = diags.some(d => d.severity === vscode.DiagnosticSeverity.Error);
      if (hasError) {
        errorFiles.push(uri);
      }
    }

    return errorFiles;
  }

  /**
   * Apply filter to tree items
   */
  private applyFilter(items: ContextTreeItem[]): ContextTreeItem[] {
    if (this.currentFilter === 'all') {
      return items;
    }

    return items.map(item => {
      if (item.itemType === ItemType.Category || item.itemType === ItemType.Summary) {
        // Filter children
        const filteredChildren = item.children.filter(child => {
          switch (this.currentFilter) {
            case 'selected':
              return child.checked;
            case 'errors':
              return this.getFilesWithErrors().some(uri => uri.fsPath === child.resourceUri?.fsPath);
            case 'modified':
              return child.fileStatus !== FileStatus.Clean;
            default:
              return true;
          }
        });

        if (filteredChildren.length > 0) {
          const newItem = { ...item };
          newItem.children = filteredChildren;
          return newItem;
        }
        return null;
      }
      return item;
    }).filter(item => item !== null) as ContextTreeItem[];
  }

  /**
   * Apply search query to tree items
   */
  private applySearch(items: ContextTreeItem[]): ContextTreeItem[] {
    if (!this.searchQuery || this.searchQuery.trim() === '') {
      return items;
    }

    const query = this.searchQuery.toLowerCase();

    return items.map(item => {
      if (item.itemType === ItemType.Category || item.itemType === ItemType.Summary) {
        // Search in children
        const matchedChildren = item.children.filter(child => {
          const label = typeof child.label === 'string' ? child.label.toLowerCase() : '';
          const description = typeof child.description === 'string' ? child.description.toLowerCase() : '';
          const fsPath = child.resourceUri?.fsPath.toLowerCase() || '';

          return label.includes(query) || description.includes(query) || fsPath.includes(query);
        });

        if (matchedChildren.length > 0) {
          const newItem = { ...item };
          newItem.children = matchedChildren;
          return newItem;
        }
        return null;
      }
      return item;
    }).filter(item => item !== null) as ContextTreeItem[];
  }

  /**
   * Sort files by specified order
   */
  private async sortFiles(files: ContextTreeItem[]): Promise<ContextTreeItem[]> {
    switch (this.currentSortOrder) {
      case 'score':
        return this.sortByScore(files);
      case 'name':
        return files.sort((a, b) => a.label.localeCompare(b.label));
      case 'size':
        return files.sort((a, b) => (b.size || 0) - (a.size || 0));
      case 'tokens':
        return files.sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
      case 'recent':
        return this.sortByRecent(files);
      default:
        return files;
    }
  }

  private async sortByScore(files: ContextTreeItem[]): Promise<ContextTreeItem[]> {
    const uris = files
      .filter(f => f.resourceUri)
      .map(f => f.resourceUri!);

    const scored = await this.smartSelector.scoreFiles(uris, {
      selectedFiles: Array.from(this.selectedFiles).map(fsPath => vscode.Uri.file(fsPath)),
      openEditors: vscode.window.visibleTextEditors.map(e => e.document.uri),
      modifiedFiles: this.gitProvider ? await this.gitProvider.getModifiedFiles().then(files => files.map(f => f.uri)) : [],
      errorFiles: this.getFilesWithErrors()
    });

    // Create a score map
    const scoreMap = new Map<string, number>();
    for (const score of scored) {
      scoreMap.set(score.uri.fsPath, score.score);
    }

    // Sort by score
    return files.sort((a, b) => {
      const scoreA = scoreMap.get(a.resourceUri?.fsPath || '') || 0;
      const scoreB = scoreMap.get(b.resourceUri?.fsPath || '') || 0;
      return scoreB - scoreA;
    });
  }

  private sortByRecent(files: ContextTreeItem[]): ContextTreeItem[] {
    // Track file access times
    return files.sort((a, b) => {
      // Files that are open get priority
      const aOpen = vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === a.resourceUri?.fsPath);
      const bOpen = vscode.window.visibleTextEditors.some(e => e.document.uri.fsPath === b.resourceUri?.fsPath);

      if (aOpen && !bOpen) return -1;
      if (!aOpen && bOpen) return 1;

      // Then sort alphabetically
      return a.label.localeCompare(b.label);
    });
  }

  /**
   * Bulk operations
   */
  public selectAll(): void {
    this.rootItems.forEach(item => {
      this.selectItemRecursive(item, true);
    });
    this.saveState();
    this.refresh();
  }

  public deselectAll(): void {
    this.rootItems.forEach(item => {
      this.selectItemRecursive(item, false);
    });
    this.saveState();
    this.refresh();
  }

  public invertSelection(): void {
    this.rootItems.forEach(item => {
      this.invertItemRecursive(item);
    });
    this.saveState();
    this.refresh();
  }

  private selectItemRecursive(item: ContextTreeItem, checked: boolean): void {
    if (item.resourceUri) {
      item.checked = checked;
      if (checked) {
        this.selectedFiles.add(item.resourceUri.fsPath);
      } else {
        this.selectedFiles.delete(item.resourceUri.fsPath);
      }
    }

    item.children.forEach(child => this.selectItemRecursive(child, checked));
  }

  private invertItemRecursive(item: ContextTreeItem): void {
    if (item.resourceUri) {
      item.checked = !item.checked;
      if (item.checked) {
        this.selectedFiles.add(item.resourceUri.fsPath);
      } else {
        this.selectedFiles.delete(item.resourceUri.fsPath);
      }
    }

    item.children.forEach(child => this.invertItemRecursive(child));
  }

  /**
   * Set search query
   */
  public setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.refresh();
  }

  /**
   * Set filter type
   */
  public setFilter(filter: FilterType): void {
    this.currentFilter = filter;
    this.refresh();
  }

  /**
   * Set sort order
   */
  public setSortOrder(order: SortOrder): void {
    this.currentSortOrder = order;
    this.refresh();
  }

  /**
   * Toggle smart suggestions
   */
  public toggleSmartSuggestions(): void {
    this.showSmartSuggestions = !this.showSmartSuggestions;
    this.refresh();
  }

  /**
   * Save state to workspace
   */
  private saveState(): void {
    this.context.workspaceState.update('selectedFiles', Array.from(this.selectedFiles));
    this.context.workspaceState.update('currentMode', this.currentMode);
    this.context.workspaceState.update('sortOrder', this.currentSortOrder);
    this.context.workspaceState.update('filter', this.currentFilter);
    this.context.workspaceState.update('showSmartSuggestions', this.showSmartSuggestions);
  }

  /**
   * Restore state from workspace
   */
  private restoreState(): void {
    const savedFiles = this.context.workspaceState.get<string[]>('selectedFiles', []);
    this.selectedFiles = new Set(savedFiles);

    const savedMode = this.context.workspaceState.get<typeof this.currentMode>('currentMode', 'git-changes');
    this.currentMode = savedMode;

    const savedSort = this.context.workspaceState.get<SortOrder>('sortOrder', 'score');
    this.currentSortOrder = savedSort;

    const savedFilter = this.context.workspaceState.get<FilterType>('filter', 'all');
    this.currentFilter = savedFilter;

    const savedShowSuggestions = this.context.workspaceState.get<boolean>('showSmartSuggestions', true);
    this.showSmartSuggestions = savedShowSuggestions;
  }

  dispose(): void {
    this.fileWatcher?.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

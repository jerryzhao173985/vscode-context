# TreeView Implementation Example: File Selection with Checkboxes

This example demonstrates a complete implementation of a TreeView that replaces a status bar button with a rich sidebar view showing workspace files with:
- Checkboxes for file selection
- Real-time size calculation
- Git status indicators
- Search/filter functionality
- State persistence

## Complete Implementation

### 1. package.json Configuration

```json
{
  "name": "file-selector-extension",
  "displayName": "File Selector",
  "version": "1.0.0",
  "engines": {
    "vscode": "^1.80.0"
  },
  "activationEvents": [
    "onView:fileSelectorView"
  ],
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "file-selector",
          "title": "File Selector",
          "icon": "resources/icon.svg"
        }
      ]
    },
    "views": {
      "file-selector": [
        {
          "id": "fileSelectorView",
          "name": "Workspace Files",
          "icon": "resources/icon.svg",
          "contextualTitle": "File Selector"
        }
      ]
    },
    "commands": [
      {
        "command": "fileSelector.refresh",
        "title": "Refresh",
        "icon": "$(refresh)"
      },
      {
        "command": "fileSelector.selectAll",
        "title": "Select All",
        "icon": "$(check-all)"
      },
      {
        "command": "fileSelector.deselectAll",
        "title": "Deselect All",
        "icon": "$(close-all)"
      },
      {
        "command": "fileSelector.filter",
        "title": "Filter Files",
        "icon": "$(filter)"
      },
      {
        "command": "fileSelector.showSelected",
        "title": "Show Selected Files"
      },
      {
        "command": "fileSelector.openFile",
        "title": "Open File"
      }
    ],
    "menus": {
      "view/title": [
        {
          "command": "fileSelector.refresh",
          "when": "view == fileSelectorView",
          "group": "navigation@1"
        },
        {
          "command": "fileSelector.filter",
          "when": "view == fileSelectorView",
          "group": "navigation@2"
        },
        {
          "command": "fileSelector.selectAll",
          "when": "view == fileSelectorView",
          "group": "1_selection@1"
        },
        {
          "command": "fileSelector.deselectAll",
          "when": "view == fileSelectorView",
          "group": "1_selection@2"
        },
        {
          "command": "fileSelector.showSelected",
          "when": "view == fileSelectorView",
          "group": "2_actions@1"
        }
      ],
      "view/item/context": [
        {
          "command": "fileSelector.openFile",
          "when": "view == fileSelectorView && viewItem == file",
          "group": "inline@1"
        }
      ],
      "commandPalette": [
        {
          "command": "fileSelector.openFile",
          "when": "false"
        }
      ]
    },
    "viewsWelcome": [
      {
        "view": "fileSelectorView",
        "contents": "No workspace folder open.\n[Open Folder](command:vscode.openFolder)"
      }
    ]
  }
}
```

### 2. File Tree Item Class

```typescript
// fileTreeItem.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export enum GitStatus {
  Unmodified = 'unmodified',
  Modified = 'modified',
  Added = 'added',
  Deleted = 'deleted',
  Untracked = 'untracked',
  Ignored = 'ignored',
  Conflicted = 'conflicted'
}

export class FileTreeItem extends vscode.TreeItem {
  public children: FileTreeItem[] = [];
  public readonly isDirectory: boolean;
  public size: number = 0;
  public gitStatus: GitStatus;
  private _checked: boolean = false;

  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly parent?: FileTreeItem,
    isDirectory?: boolean
  ) {
    const basename = path.basename(resourceUri.fsPath);
    const collapsibleState = isDirectory
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    super(resourceUri, collapsibleState);

    this.isDirectory = isDirectory ?? false;
    this.label = basename;
    this.id = resourceUri.fsPath;
    this.gitStatus = GitStatus.Unmodified;

    // Set context value for menu filtering
    this.contextValue = this.isDirectory ? 'directory' : 'file';

    // Add checkbox
    this.checkboxState = {
      state: vscode.TreeItemCheckboxState.Unchecked,
      tooltip: 'Select for processing',
      accessibilityInformation: {
        label: `${basename}, ${this.isDirectory ? 'folder' : 'file'}, unchecked`,
        role: 'checkbox'
      }
    };

    // Calculate size asynchronously
    this.calculateSize().then(size => {
      this.size = size;
      this.updateDescription();
    });

    // Set icon
    this.updateIcon();

    // Set command for files
    if (!this.isDirectory) {
      this.command = {
        command: 'fileSelector.openFile',
        title: 'Open File',
        arguments: [this]
      };
    }
  }

  get checked(): boolean {
    return this._checked;
  }

  set checked(value: boolean) {
    this._checked = value;
    this.checkboxState = {
      state: value
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked,
      tooltip: value ? 'Deselect' : 'Select for processing',
      accessibilityInformation: {
        label: `${this.label}, ${this.isDirectory ? 'folder' : 'file'}, ${
          value ? 'checked' : 'unchecked'
        }`,
        role: 'checkbox'
      }
    };
  }

  private async calculateSize(): Promise<number> {
    try {
      if (this.isDirectory) {
        return await this.calculateDirectorySize(this.resourceUri.fsPath);
      } else {
        const stats = await fs.promises.stat(this.resourceUri.fsPath);
        return stats.size;
      }
    } catch (error) {
      console.error('Error calculating size:', error);
      return 0;
    }
  }

  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(fullPath);
        } else {
          const stats = await fs.promises.stat(fullPath);
          totalSize += stats.size;
        }
      }
    } catch (error) {
      // Handle permission errors, etc.
      console.error('Error reading directory:', error);
    }

    return totalSize;
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
  }

  private updateDescription(): void {
    const parts: string[] = [];

    // Add size
    if (this.size > 0) {
      parts.push(this.formatSize(this.size));
    }

    // Add git status
    if (this.gitStatus !== GitStatus.Unmodified) {
      const statusMap: Record<GitStatus, string> = {
        [GitStatus.Unmodified]: '',
        [GitStatus.Modified]: 'M',
        [GitStatus.Added]: 'A',
        [GitStatus.Deleted]: 'D',
        [GitStatus.Untracked]: 'U',
        [GitStatus.Ignored]: 'I',
        [GitStatus.Conflicted]: 'C'
      };
      parts.push(statusMap[this.gitStatus]);
    }

    this.description = parts.join(' • ');
  }

  private updateIcon(): void {
    if (this.isDirectory) {
      this.iconPath = new vscode.ThemeIcon(
        'folder',
        this.gitStatus === GitStatus.Modified
          ? new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
          : undefined
      );
    } else {
      // VS Code automatically provides file icons based on extension
      this.iconPath = vscode.ThemeIcon.File;
    }
  }

  public updateGitStatus(status: GitStatus): void {
    this.gitStatus = status;
    this.updateDescription();
    this.updateIcon();
  }

  public updateTooltip(): void {
    const lines = [
      `**${this.label}**`,
      '',
      `Path: ${this.resourceUri.fsPath}`,
      `Type: ${this.isDirectory ? 'Directory' : 'File'}`,
      `Size: ${this.formatSize(this.size)}`
    ];

    if (this.gitStatus !== GitStatus.Unmodified) {
      lines.push(`Git Status: ${this.gitStatus}`);
    }

    if (this.checked) {
      lines.push('', '✓ Selected for processing');
    }

    this.tooltip = new vscode.MarkdownString(lines.join('\n'));
  }
}
```

### 3. Tree Data Provider

```typescript
// fileSelectorProvider.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileTreeItem, GitStatus } from './fileTreeItem';

export class FileSelectorProvider implements vscode.TreeDataProvider<FileTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<FileTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _onDidChangeCheckboxState = new vscode.EventEmitter<vscode.TreeCheckboxChangeEvent<FileTreeItem>>();
  readonly onDidChangeCheckboxState = this._onDidChangeCheckboxState.event;

  private rootItems: FileTreeItem[] = [];
  private itemCache: Map<string, FileTreeItem> = new Map();
  private filterText: string = '';
  private fileWatcher: vscode.FileSystemWatcher;
  private gitExtension: any;

  constructor(
    private workspaceRoot: string,
    private context: vscode.ExtensionContext
  ) {
    // Setup file watcher
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '**/*')
    );

    this.fileWatcher.onDidCreate(uri => this.handleFileChange(uri, 'created'));
    this.fileWatcher.onDidChange(uri => this.handleFileChange(uri, 'changed'));
    this.fileWatcher.onDidDelete(uri => this.handleFileChange(uri, 'deleted'));

    context.subscriptions.push(this.fileWatcher);

    // Get git extension
    this.initGitExtension();

    // Listen for checkbox changes
    this.onDidChangeCheckboxState.event(e => {
      e.items.forEach(([item, state]) => {
        item.checked = state === vscode.TreeItemCheckboxState.Checked;
        this.updateParentCheckboxes(item);
        this.saveSelectionState();
      });
    });

    // Restore previous state
    this.restoreState();
  }

  private initGitExtension(): void {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
      this.gitExtension = gitExtension.exports.getAPI(1);
    }
  }

  // Required methods

  getTreeItem(element: FileTreeItem): vscode.TreeItem {
    element.updateTooltip();
    return element;
  }

  async getChildren(element?: FileTreeItem): Promise<FileTreeItem[]> {
    if (!element) {
      // Root level
      if (this.rootItems.length === 0) {
        await this.loadRootItems();
      }
      return this.applyFilter(this.rootItems);
    }

    // Return cached children if available
    if (element.children.length > 0) {
      return this.applyFilter(element.children);
    }

    // Load children
    await this.loadChildren(element);
    return this.applyFilter(element.children);
  }

  getParent(element: FileTreeItem): vscode.ProviderResult<FileTreeItem> {
    return element.parent;
  }

  // Loading methods

  private async loadRootItems(): Promise<void> {
    this.rootItems = [];
    this.itemCache.clear();

    try {
      const entries = await fs.promises.readdir(this.workspaceRoot, {
        withFileTypes: true
      });

      for (const entry of entries) {
        // Skip hidden files and common excludes
        if (entry.name.startsWith('.') || this.shouldExclude(entry.name)) {
          continue;
        }

        const uri = vscode.Uri.file(path.join(this.workspaceRoot, entry.name));
        const item = new FileTreeItem(uri, undefined, entry.isDirectory());

        // Update git status
        await this.updateGitStatus(item);

        this.rootItems.push(item);
        this.itemCache.set(item.id, item);
      }

      // Sort: directories first, then alphabetically
      this.rootItems.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.label!.toString().localeCompare(b.label!.toString());
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading files: ${error}`);
    }
  }

  private async loadChildren(parent: FileTreeItem): Promise<void> {
    if (!parent.isDirectory) {
      return;
    }

    try {
      const entries = await fs.promises.readdir(parent.resourceUri.fsPath, {
        withFileTypes: true
      });

      parent.children = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.') || this.shouldExclude(entry.name)) {
          continue;
        }

        const uri = vscode.Uri.file(
          path.join(parent.resourceUri.fsPath, entry.name)
        );
        const item = new FileTreeItem(uri, parent, entry.isDirectory());

        await this.updateGitStatus(item);

        parent.children.push(item);
        this.itemCache.set(item.id, item);
      }

      // Sort children
      parent.children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.label!.toString().localeCompare(b.label!.toString());
      });
    } catch (error) {
      console.error('Error loading children:', error);
    }
  }

  private shouldExclude(name: string): boolean {
    const excludePatterns = ['node_modules', 'dist', 'out', 'build', '.git'];
    return excludePatterns.includes(name);
  }

  // Git integration

  private async updateGitStatus(item: FileTreeItem): Promise<void> {
    if (!this.gitExtension) {
      return;
    }

    try {
      const repo = this.gitExtension.repositories[0];
      if (!repo) {
        return;
      }

      const relativePath = path.relative(
        repo.rootUri.fsPath,
        item.resourceUri.fsPath
      );

      const status = repo.state.workingTreeChanges.find(
        (change: any) => change.uri.fsPath === item.resourceUri.fsPath
      );

      if (status) {
        const statusMap: Record<number, GitStatus> = {
          0: GitStatus.Unmodified,
          1: GitStatus.Added,
          2: GitStatus.Deleted,
          3: GitStatus.Modified,
          7: GitStatus.Untracked
        };

        item.updateGitStatus(statusMap[status.status] || GitStatus.Unmodified);
      }
    } catch (error) {
      console.error('Error getting git status:', error);
    }
  }

  // Filter implementation

  public async setFilter(filterText: string): Promise<void> {
    this.filterText = filterText.toLowerCase();
    this._onDidChangeTreeData.fire();
  }

  private applyFilter(items: FileTreeItem[]): FileTreeItem[] {
    if (!this.filterText) {
      return items;
    }

    return items.filter(item => {
      const label = item.label?.toString().toLowerCase() || '';
      return label.includes(this.filterText);
    });
  }

  // Checkbox management

  private updateParentCheckboxes(item: FileTreeItem): void {
    if (!item.parent) {
      return;
    }

    // Check if all siblings are checked
    const allSiblingsChecked = item.parent.children.every(child => child.checked);

    if (allSiblingsChecked) {
      item.parent.checked = true;
    } else if (!item.checked) {
      item.parent.checked = false;
    }

    this._onDidChangeTreeData.fire(item.parent);
    this.updateParentCheckboxes(item.parent);
  }

  public selectAll(): void {
    this.setAllCheckboxes(true);
  }

  public deselectAll(): void {
    this.setAllCheckboxes(false);
  }

  private setAllCheckboxes(checked: boolean): void {
    const setRecursive = (items: FileTreeItem[]) => {
      items.forEach(item => {
        item.checked = checked;
        if (item.children.length > 0) {
          setRecursive(item.children);
        }
      });
    };

    setRecursive(this.rootItems);
    this._onDidChangeTreeData.fire();
    this.saveSelectionState();
  }

  // State persistence

  private async saveSelectionState(): Promise<void> {
    const selectedPaths = this.getSelectedPaths();
    await this.context.workspaceState.update('selectedFiles', selectedPaths);
  }

  private async restoreState(): Promise<void> {
    const selectedPaths =
      this.context.workspaceState.get<string[]>('selectedFiles') || [];

    // Wait for items to load
    await this.loadRootItems();

    // Restore selection
    selectedPaths.forEach(filePath => {
      const item = this.itemCache.get(filePath);
      if (item) {
        item.checked = true;
      }
    });

    this._onDidChangeTreeData.fire();
  }

  // Helper methods

  public getSelectedPaths(): string[] {
    const paths: string[] = [];

    const collectPaths = (items: FileTreeItem[]) => {
      items.forEach(item => {
        if (item.checked) {
          paths.push(item.resourceUri.fsPath);
        }
        if (item.children.length > 0) {
          collectPaths(item.children);
        }
      });
    };

    collectPaths(this.rootItems);
    return paths;
  }

  public getSelectedItems(): FileTreeItem[] {
    const items: FileTreeItem[] = [];

    const collectItems = (treeItems: FileTreeItem[]) => {
      treeItems.forEach(item => {
        if (item.checked) {
          items.push(item);
        }
        if (item.children.length > 0) {
          collectItems(item.children);
        }
      });
    };

    collectItems(this.rootItems);
    return items;
  }

  public getTotalSelectedSize(): number {
    const selectedItems = this.getSelectedItems();
    return selectedItems.reduce((total, item) => total + item.size, 0);
  }

  // Refresh methods

  public refresh(): void {
    this.rootItems = [];
    this.itemCache.clear();
    this._onDidChangeTreeData.fire();
  }

  public refreshItem(item: FileTreeItem): void {
    item.children = [];
    this._onDidChangeTreeData.fire(item);
  }

  private refreshDebounceTimer: NodeJS.Timeout | undefined;

  private handleFileChange(uri: vscode.Uri, changeType: string): void {
    console.log(`File ${changeType}:`, uri.fsPath);

    // Debounced refresh
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }

    this.refreshDebounceTimer = setTimeout(() => {
      const item = this.itemCache.get(uri.fsPath);
      if (item) {
        this.refreshItem(item.parent || item);
      } else {
        this.refresh();
      }
    }, 300);
  }

  // Cleanup

  public dispose(): void {
    this.fileWatcher.dispose();
  }
}
```

### 4. Extension Activation

```typescript
// extension.ts
import * as vscode from 'vscode';
import { FileSelectorProvider } from './fileSelectorProvider';
import { FileTreeItem } from './fileTreeItem';

export function activate(context: vscode.ExtensionContext) {
  console.log('File Selector extension activated');

  // Get workspace root
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

  if (!workspaceRoot) {
    vscode.window.showWarningMessage('No workspace folder open');
    return;
  }

  // Create tree data provider
  const treeDataProvider = new FileSelectorProvider(workspaceRoot, context);

  // Create tree view
  const treeView = vscode.window.createTreeView('fileSelectorView', {
    treeDataProvider,
    showCollapseAll: true,
    canSelectMany: true
  });

  // Set initial message
  treeView.message = 'Loading files...';

  // Update message when selection changes
  treeView.onDidChangeSelection(e => {
    const count = e.selection.length;
    if (count > 0) {
      treeView.message = `${count} item${count === 1 ? '' : 's'} selected`;
    } else {
      treeView.message = undefined;
    }
  });

  // Register commands

  context.subscriptions.push(
    vscode.commands.registerCommand('fileSelector.refresh', () => {
      treeDataProvider.refresh();
      vscode.window.showInformationMessage('File list refreshed');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fileSelector.selectAll', () => {
      treeDataProvider.selectAll();
      vscode.window.showInformationMessage('All files selected');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fileSelector.deselectAll', () => {
      treeDataProvider.deselectAll();
      vscode.window.showInformationMessage('All files deselected');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fileSelector.filter', async () => {
      const filterText = await vscode.window.showInputBox({
        prompt: 'Enter filter text',
        placeHolder: 'Type to filter files...',
        value: ''
      });

      if (filterText !== undefined) {
        await treeDataProvider.setFilter(filterText);
        if (filterText) {
          vscode.window.showInformationMessage(`Filtering by: ${filterText}`);
        } else {
          vscode.window.showInformationMessage('Filter cleared');
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fileSelector.showSelected', async () => {
      const selectedItems = treeDataProvider.getSelectedItems();
      const totalSize = treeDataProvider.getTotalSelectedSize();

      if (selectedItems.length === 0) {
        vscode.window.showInformationMessage('No files selected');
        return;
      }

      const formattedSize = formatSize(totalSize);

      const items = selectedItems.map(item => ({
        label: item.label?.toString() || '',
        description: item.description,
        detail: item.resourceUri.fsPath,
        item
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `${selectedItems.length} files selected (Total: ${formattedSize})`,
        canPickMany: false
      });

      if (selected) {
        await treeView.reveal(selected.item, {
          select: true,
          focus: true,
          expand: true
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'fileSelector.openFile',
      async (item: FileTreeItem) => {
        if (!item.isDirectory) {
          await vscode.window.showTextDocument(item.resourceUri);
        }
      }
    )
  );

  // Add status bar item for selected files
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = 'fileSelector.showSelected';

  const updateStatusBar = () => {
    const selectedItems = treeDataProvider.getSelectedItems();
    const totalSize = treeDataProvider.getTotalSelectedSize();

    if (selectedItems.length > 0) {
      statusBarItem.text = `$(files) ${selectedItems.length} files (${formatSize(totalSize)})`;
      statusBarItem.tooltip = 'Click to view selected files';
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };

  // Update status bar on selection changes
  treeView.onDidChangeSelection(() => {
    updateStatusBar();
  });

  context.subscriptions.push(treeView, treeDataProvider, statusBarItem);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

export function deactivate() {
  console.log('File Selector extension deactivated');
}
```

## Features Demonstrated

### 1. Checkboxes with State Management
- Checkboxes on all tree items
- Parent/child checkbox synchronization
- State persistence across sessions

### 2. Real-Time Size Calculation
- Asynchronous size calculation
- Formatted display (B, KB, MB, GB)
- Directory size aggregation

### 3. Git Status Integration
- Git status indicators (M, A, D, U, etc.)
- Color-coded decorations
- Integration with VS Code's Git extension

### 4. File System Watching
- Auto-refresh on file changes
- Debounced updates
- Efficient partial refreshes

### 5. Search/Filter
- Dynamic filtering by filename
- Maintains tree structure
- Clear filter functionality

### 6. State Persistence
- Saves selected files
- Restores selection on reload
- Workspace-specific storage

### 7. Rich UI Elements
- Inline actions
- Context menus
- Status bar integration
- Tooltips with details
- Welcome view for empty state

### 8. Performance Optimizations
- Lazy loading of children
- Caching loaded items
- Debounced refresh
- Efficient file watching

## Usage

1. Install and activate the extension
2. Open a workspace folder
3. View the "File Selector" panel in the activity bar
4. Check/uncheck files to select them
5. Use the toolbar buttons to:
   - Refresh the file list
   - Filter files
   - Select/deselect all
   - View selected files
6. Status bar shows total selected files and size
7. Selection persists across VS Code sessions

## Key Patterns Used

- ✓ TreeDataProvider with checkbox support
- ✓ Event emitters for data changes
- ✓ FileSystemWatcher for auto-refresh
- ✓ Git extension integration
- ✓ State persistence with Memento API
- ✓ Lazy loading and caching
- ✓ Debounced operations
- ✓ Rich tooltips and descriptions
- ✓ Context-aware commands
- ✓ Status bar integration
- ✓ Proper resource disposal

## Testing

To test the implementation:

1. Create a new workspace
2. Add/modify/delete files - observe auto-refresh
3. Check files and verify status bar updates
4. Reload VS Code - verify selection persists
5. Test filter functionality
6. Check git status indicators (in a git repository)
7. Test with large directories for performance

## Next Steps

Potential enhancements:
- Add file/folder exclusion patterns
- Implement drag-and-drop
- Add file preview on hover
- Export selected files list
- Batch operations on selected files
- Custom sort options
- Search by content
- Integration with other extensions

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';

export enum ItemType {
  File = 'file',
  Folder = 'folder',
  Category = 'category',
  Summary = 'summary'
}

export enum FileStatus {
  Clean = 'clean',
  Modified = 'modified',
  Added = 'added',
  Deleted = 'deleted',
  Untracked = 'untracked',
  Staged = 'staged'
}

export class ContextTreeItem extends vscode.TreeItem {
  public children: ContextTreeItem[] = [];
  public readonly itemType: ItemType;
  public fileStatus: FileStatus = FileStatus.Clean;
  private _checked: boolean = false;
  private _size: number = 0;
  private _tokens: number = 0;
  public score?: number;
  public reasons?: string[];

  constructor(
    public readonly resourceUri: vscode.Uri | undefined,
    public readonly label: string,
    itemType: ItemType,
    collapsibleState?: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    this.itemType = itemType;
    this.id = resourceUri?.fsPath || label;
    this.contextValue = this.getContextValue();

    // Setup based on item type
    switch (itemType) {
      case ItemType.File:
        this.setupFile();
        break;
      case ItemType.Folder:
        this.setupFolder();
        break;
      case ItemType.Category:
        this.setupCategory();
        break;
      case ItemType.Summary:
        this.setupSummary();
        break;
    }
  }

  private getContextValue(): string {
    // Add context value for inline actions
    const values: string[] = [this.itemType];

    if (this.itemType === ItemType.File) {
      values.push('file');
      if (this._checked) {
        values.push('selected');
      }
      if (this.fileStatus !== FileStatus.Clean) {
        values.push('modified');
      }
    }

    return values.join('-');
  }

  private setupFile(): void {
    if (!this.resourceUri) return;

    // Add checkbox
    this.checkboxState = {
      state: vscode.TreeItemCheckboxState.Unchecked,
      tooltip: 'Select for context',
      accessibilityInformation: {
        label: `${this.label}, file, unchecked`,
        role: 'checkbox'
      }
    };

    // Set command to open file
    this.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [this.resourceUri]
    };

    // Calculate size and tokens
    this.calculateMetrics();
  }

  private setupFolder(): void {
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    this.iconPath = new vscode.ThemeIcon('folder');

    // Add checkbox
    this.checkboxState = {
      state: vscode.TreeItemCheckboxState.Unchecked,
      tooltip: 'Select all files in folder',
      accessibilityInformation: {
        label: `${this.label}, folder, unchecked`,
        role: 'checkbox'
      }
    };
  }

  private setupCategory(): void {
    this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    this.iconPath = new vscode.ThemeIcon('symbol-folder');
  }

  private setupSummary(): void {
    this.collapsibleState = vscode.TreeItemCollapsibleState.None;
    this.iconPath = new vscode.ThemeIcon('info');
  }

  get checked(): boolean {
    return this._checked;
  }

  set checked(value: boolean) {
    this._checked = value;

    if (this.checkboxState) {
      this.checkboxState = {
        state: value
          ? vscode.TreeItemCheckboxState.Checked
          : vscode.TreeItemCheckboxState.Unchecked,
        tooltip: value ? 'Deselect' : 'Select for context',
        accessibilityInformation: {
          label: `${this.label}, ${this.itemType}, ${value ? 'checked' : 'unchecked'}`,
          role: 'checkbox'
        }
      };
    }

    // Update context value for inline actions
    this.contextValue = this.getContextValue();

    this.updateTooltip();
  }

  get size(): number {
    return this._size;
  }

  set size(value: number) {
    this._size = value;
    this.updateDescription();
  }

  get tokens(): number {
    return this._tokens;
  }

  set tokens(value: number) {
    this._tokens = value;
    this.updateDescription();
  }

  private async calculateMetrics(): Promise<void> {
    if (!this.resourceUri || this.itemType !== ItemType.File) {
      return;
    }

    try {
      const stats = await fs.stat(this.resourceUri.fsPath);
      this._size = stats.size;

      // Rough token estimate: 1 token ≈ 4 characters
      this._tokens = Math.ceil(this._size / 4);

      this.updateDescription();
    } catch (error) {
      console.error('Error calculating metrics:', error);
    }
  }

  private updateDescription(): void {
    if (this.itemType === ItemType.Summary) {
      return; // Summary has custom description
    }

    const parts: string[] = [];

    // Add file status
    if (this.fileStatus !== FileStatus.Clean) {
      const statusIcons: Record<FileStatus, string> = {
        [FileStatus.Clean]: '',
        [FileStatus.Modified]: 'M',
        [FileStatus.Added]: 'A',
        [FileStatus.Deleted]: 'D',
        [FileStatus.Untracked]: 'U',
        [FileStatus.Staged]: 'S'
      };
      parts.push(statusIcons[this.fileStatus]);
    }

    // Add size for files
    if (this.itemType === ItemType.File && this._size > 0) {
      parts.push(this.formatSize(this._size));
    }

    // Add token count if checked
    if (this._checked && this._tokens > 0) {
      if (this._tokens < 1000) {
        parts.push(`${this._tokens} tokens`);
      } else {
        parts.push(`${(this._tokens / 1000).toFixed(1)}K tokens`);
      }
    }

    this.description = parts.join(' • ');
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  public updateFileStatus(status: FileStatus): void {
    this.fileStatus = status;
    this.updateDescription();
    this.updateIcon();
  }

  private updateIcon(): void {
    if (this.itemType === ItemType.File && this.resourceUri) {
      // Use theme icon for modified files
      if (this.fileStatus === FileStatus.Modified || this.fileStatus === FileStatus.Staged) {
        this.iconPath = new vscode.ThemeIcon(
          'file',
          new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
        );
      } else if (this.fileStatus === FileStatus.Added) {
        this.iconPath = new vscode.ThemeIcon(
          'file',
          new vscode.ThemeColor('gitDecoration.addedResourceForeground')
        );
      } else if (this.fileStatus === FileStatus.Deleted) {
        this.iconPath = new vscode.ThemeIcon(
          'file',
          new vscode.ThemeColor('gitDecoration.deletedResourceForeground')
        );
      } else if (this.fileStatus === FileStatus.Untracked) {
        this.iconPath = new vscode.ThemeIcon(
          'file',
          new vscode.ThemeColor('gitDecoration.untrackedResourceForeground')
        );
      } else {
        this.iconPath = vscode.ThemeIcon.File;
      }
    }
  }

  public updateTooltip(): void {
    if (this.itemType === ItemType.Summary) {
      return; // Summary has custom tooltip
    }

    const lines: string[] = [`**${this.label}**`, ''];

    if (this.resourceUri) {
      lines.push(`Path: ${this.resourceUri.fsPath}`);
    }

    lines.push(`Type: ${this.itemType}`);

    if (this._size > 0) {
      lines.push(`Size: ${this.formatSize(this._size)}`);
    }

    if (this._tokens > 0) {
      lines.push(`Est. Tokens: ${this._tokens.toLocaleString()}`);
    }

    if (this.fileStatus !== FileStatus.Clean) {
      lines.push(`Git Status: ${this.fileStatus}`);
    }

    if (this.score !== undefined) {
      lines.push('', `**Relevance Score:** ${this.score.toFixed(1)}`);

      if (this.reasons && this.reasons.length > 0) {
        lines.push('', '**Why suggested:**');
        for (const reason of this.reasons) {
          lines.push(`- ${reason}`);
        }
      }
    }

    if (this._checked) {
      lines.push('', '✓ Selected for context');
    }

    this.tooltip = new vscode.MarkdownString(lines.join('\n'));
  }

  /**
   * Create a summary item showing token count and cost
   */
  public static createSummary(
    totalFiles: number,
    totalTokens: number,
    estimatedCost: number
  ): ContextTreeItem {
    const item = new ContextTreeItem(
      undefined,
      '📊 Selection Summary',
      ItemType.Summary,
      vscode.TreeItemCollapsibleState.None
    );

    item.description = `${totalFiles} files • ${(totalTokens / 1000).toFixed(1)}K tokens • $${estimatedCost.toFixed(3)}`;

    const tooltipLines = [
      '**Context Summary**',
      '',
      `Files selected: ${totalFiles}`,
      `Total tokens: ${totalTokens.toLocaleString()}`,
      `Estimated cost: $${estimatedCost.toFixed(4)}`,
    ];

    item.tooltip = new vscode.MarkdownString(tooltipLines.join('\n'));

    return item;
  }

  /**
   * Create a category item for grouping files
   */
  public static createCategory(label: string, icon?: string): ContextTreeItem {
    const item = new ContextTreeItem(
      undefined,
      label,
      ItemType.Category,
      vscode.TreeItemCollapsibleState.Expanded
    );

    if (icon) {
      item.iconPath = new vscode.ThemeIcon(icon);
    }

    return item;
  }
}

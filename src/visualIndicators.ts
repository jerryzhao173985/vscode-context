import * as vscode from 'vscode';

/**
 * Centralized color scheme for consistent UI
 */
export const ColorScheme = {
  // Status colors
  success: new vscode.ThemeColor('testing.iconPassed'),
  warning: new vscode.ThemeColor('testing.iconQueued'),
  error: new vscode.ThemeColor('testing.iconFailed'),
  info: new vscode.ThemeColor('charts.blue'),

  // Score colors
  scoreHigh: new vscode.ThemeColor('charts.green'),
  scoreMedium: new vscode.ThemeColor('charts.yellow'),
  scoreLow: new vscode.ThemeColor('charts.orange'),
  scoreVeryLow: new vscode.ThemeColor('charts.red'),

  // Git colors
  gitModified: new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
  gitAdded: new vscode.ThemeColor('gitDecoration.addedResourceForeground'),
  gitDeleted: new vscode.ThemeColor('gitDecoration.deletedResourceForeground'),
  gitUntracked: new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'),

  // Relationship colors
  relationshipStrong: new vscode.ThemeColor('charts.purple'),
  relationshipMedium: new vscode.ThemeColor('charts.blue'),
  relationshipWeak: new vscode.ThemeColor('charts.gray')
} as const;

/**
 * Icon definitions for consistent iconography
 */
export const Icons = {
  // File types
  file: 'file',
  folder: 'folder',
  folderOpen: 'folder-opened',

  // Status
  success: 'pass',
  warning: 'warning',
  error: 'error',
  info: 'info',

  // Actions
  add: 'add',
  remove: 'remove',
  edit: 'edit',
  refresh: 'refresh',
  save: 'save',
  trash: 'trash',
  copy: 'copy',

  // Navigation
  next: 'arrow-right',
  previous: 'arrow-left',
  up: 'arrow-up',
  down: 'arrow-down',

  // Features
  search: 'search',
  filter: 'filter',
  sort: 'sort-precedence',
  bookmark: 'bookmark',
  tag: 'tag',
  lightbulb: 'lightbulb',
  sparkle: 'sparkle',
  gear: 'gear',

  // Git
  gitBranch: 'git-branch',
  gitCommit: 'git-commit',
  gitCompare: 'git-compare',
  gitPullRequest: 'git-pull-request',

  // Files
  bug: 'bug',
  check: 'check',
  clock: 'clock',
  history: 'history',
  telescope: 'telescope',
  shield: 'shield',
  graph: 'graph',
  package: 'package',

  // Misc
  star: 'star',
  starFull: 'star-full',
  heart: 'heart',
  flame: 'flame',
  zap: 'zap'
} as const;

export type IconName = typeof Icons[keyof typeof Icons];

/**
 * Badge generator for file items
 */
export class BadgeGenerator {
  /**
   * Create a score badge with color coding
   */
  static createScoreBadge(score: number): { text: string; color: vscode.ThemeColor } {
    let text: string;
    let color: vscode.ThemeColor;

    if (score >= 100) {
      text = '⭐⭐⭐';
      color = ColorScheme.scoreHigh;
    } else if (score >= 50) {
      text = '⭐⭐';
      color = ColorScheme.scoreMedium;
    } else if (score >= 20) {
      text = '⭐';
      color = ColorScheme.scoreLow;
    } else {
      text = '•';
      color = ColorScheme.scoreVeryLow;
    }

    return { text, color };
  }

  /**
   * Create a token count badge
   */
  static createTokenBadge(tokens: number): { text: string; color?: vscode.ThemeColor } {
    let text: string;
    let color: vscode.ThemeColor | undefined;

    if (tokens < 1000) {
      text = `${tokens}`;
    } else if (tokens < 1000000) {
      text = `${(tokens / 1000).toFixed(1)}K`;
    } else {
      text = `${(tokens / 1000000).toFixed(1)}M`;
    }

    // Color code based on size
    if (tokens > 50000) {
      color = ColorScheme.error;
    } else if (tokens > 10000) {
      color = ColorScheme.warning;
    }

    return { text, color };
  }

  /**
   * Create a file size badge
   */
  static createSizeBadge(bytes: number): { text: string; color?: vscode.ThemeColor } {
    let text: string;
    let color: vscode.ThemeColor | undefined;

    if (bytes < 1024) {
      text = `${bytes}B`;
    } else if (bytes < 1024 * 1024) {
      text = `${(bytes / 1024).toFixed(1)}KB`;
    } else {
      text = `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }

    // Color code based on size
    if (bytes > 5 * 1024 * 1024) {
      color = ColorScheme.error;
    } else if (bytes > 1024 * 1024) {
      color = ColorScheme.warning;
    }

    return { text, color };
  }

  /**
   * Create a relationship strength badge
   */
  static createRelationshipBadge(confidence: number): { text: string; color: vscode.ThemeColor } {
    let text: string;
    let color: vscode.ThemeColor;

    const percentage = Math.round(confidence * 100);
    text = `${percentage}%`;

    if (confidence >= 0.8) {
      color = ColorScheme.relationshipStrong;
    } else if (confidence >= 0.5) {
      color = ColorScheme.relationshipMedium;
    } else {
      color = ColorScheme.relationshipWeak;
    }

    return { text, color };
  }

  /**
   * Create a health grade badge
   */
  static createHealthBadge(grade: 'A' | 'B' | 'C' | 'D' | 'F'): { text: string; color: vscode.ThemeColor } {
    const text = grade;
    let color: vscode.ThemeColor;

    switch (grade) {
      case 'A':
        color = ColorScheme.scoreHigh;
        break;
      case 'B':
        color = ColorScheme.scoreMedium;
        break;
      case 'C':
        color = ColorScheme.scoreLow;
        break;
      case 'D':
      case 'F':
        color = ColorScheme.error;
        break;
    }

    return { text, color };
  }
}

/**
 * Progress indicator for long operations
 */
export class ProgressIndicator {
  private progress?: vscode.Progress<{ message?: string; increment?: number }>;
  private resolve?: () => void;

  async show(title: string, task: (progress: ProgressIndicator) => Promise<void>): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      async (progress) => {
        this.progress = progress;
        await task(this);
        this.progress = undefined;
      }
    );
  }

  update(message: string, increment?: number): void {
    this.progress?.report({ message, increment });
  }
}

/**
 * Tooltip builder for consistent tooltips
 */
export class TooltipBuilder {
  private lines: string[] = [];

  addHeader(text: string): this {
    this.lines.push(`**${text}**`);
    this.lines.push('');
    return this;
  }

  addLine(text: string): this {
    this.lines.push(text);
    return this;
  }

  addKeyValue(key: string, value: string | number): this {
    this.lines.push(`${key}: ${value}`);
    return this;
  }

  addSeparator(): this {
    this.lines.push('');
    return this;
  }

  addList(items: string[]): this {
    items.forEach(item => this.lines.push(`- ${item}`));
    return this;
  }

  addBulletPoint(text: string): this {
    this.lines.push(`• ${text}`);
    return this;
  }

  build(): vscode.MarkdownString {
    return new vscode.MarkdownString(this.lines.join('\n'));
  }
}

/**
 * Status bar item builder
 */
export class StatusBarItemBuilder {
  private item: vscode.StatusBarItem;

  constructor(alignment: vscode.StatusBarAlignment = vscode.StatusBarAlignment.Right, priority: number = 100) {
    this.item = vscode.window.createStatusBarItem(alignment, priority);
  }

  setText(text: string): this {
    this.item.text = text;
    return this;
  }

  setTooltip(tooltip: string | vscode.MarkdownString): this {
    this.item.tooltip = tooltip;
    return this;
  }

  setCommand(command: string): this {
    this.item.command = command;
    return this;
  }

  setColor(color: string | vscode.ThemeColor): this {
    this.item.color = color;
    return this;
  }

  setBackground(color: vscode.ThemeColor): this {
    this.item.backgroundColor = color;
    return this;
  }

  build(): vscode.StatusBarItem {
    return this.item;
  }
}

/**
 * Tree item decorator
 */
export class TreeItemDecorator {
  /**
   * Add badge to tree item description
   */
  static addBadge(
    item: vscode.TreeItem,
    badge: { text: string; color?: vscode.ThemeColor }
  ): void {
    const currentDesc = item.description || '';
    item.description = currentDesc ? `${currentDesc} ${badge.text}` : badge.text;
  }

  /**
   * Add multiple badges
   */
  static addBadges(
    item: vscode.TreeItem,
    badges: Array<{ text: string; color?: vscode.ThemeColor }>
  ): void {
    const badgeText = badges.map(b => b.text).join(' ');
    const currentDesc = item.description || '';
    item.description = currentDesc ? `${currentDesc} ${badgeText}` : badgeText;
  }

  /**
   * Set icon with color
   */
  static setIcon(
    item: vscode.TreeItem,
    iconName: IconName,
    color?: vscode.ThemeColor
  ): void {
    item.iconPath = color
      ? new vscode.ThemeIcon(iconName, color)
      : new vscode.ThemeIcon(iconName);
  }

  /**
   * Set context value for inline actions
   */
  static setContextValue(
    item: vscode.TreeItem,
    values: string[]
  ): void {
    item.contextValue = values.join('-');
  }
}

/**
 * Quick pick item builder
 */
export class QuickPickItemBuilder {
  private item: vscode.QuickPickItem & { [key: string]: any };

  constructor() {
    this.item = {
      label: '',
      description: '',
      detail: ''
    };
  }

  setLabel(label: string, icon?: IconName): this {
    this.item.label = icon ? `$(${icon}) ${label}` : label;
    return this;
  }

  setDescription(description: string): this {
    this.item.description = description;
    return this;
  }

  setDetail(detail: string): this {
    this.item.detail = detail;
    return this;
  }

  setPicked(picked: boolean): this {
    this.item.picked = picked;
    return this;
  }

  setAlwaysShow(alwaysShow: boolean): this {
    this.item.alwaysShow = alwaysShow;
    return this;
  }

  setData<T>(key: string, value: T): this {
    this.item[key] = value;
    return this;
  }

  build<T extends vscode.QuickPickItem>(): T {
    return this.item as T;
  }
}

/**
 * Visual feedback utilities
 */
export class VisualFeedback {
  /**
   * Show success message with icon
   */
  static showSuccess(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(`$(check) ${message}`, ...actions);
  }

  /**
   * Show warning message with icon
   */
  static showWarning(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showWarningMessage(`$(warning) ${message}`, ...actions);
  }

  /**
   * Show error message with icon
   */
  static showError(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showErrorMessage(`$(error) ${message}`, ...actions);
  }

  /**
   * Show info message with icon
   */
  static showInfo(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(`$(info) ${message}`, ...actions);
  }

  /**
   * Show loading message
   */
  static showLoading(message: string): vscode.Disposable {
    return vscode.window.setStatusBarMessage(`$(sync~spin) ${message}`);
  }
}

/**
 * Consistent spacing constants
 */
export const Spacing = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24
} as const;

/**
 * Format utilities for consistent display
 */
export class FormatUtils {
  /**
   * Format number with locale
   */
  static formatNumber(num: number): string {
    return num.toLocaleString();
  }

  /**
   * Format percentage
   */
  static formatPercentage(value: number, decimals: number = 1): string {
    return `${value.toFixed(decimals)}%`;
  }

  /**
   * Format time ago
   */
  static formatTimeAgo(timestamp: number): string {
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

    return new Date(timestamp).toLocaleDateString();
  }

  /**
   * Format duration
   */
  static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  /**
   * Format file size
   */
  static formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

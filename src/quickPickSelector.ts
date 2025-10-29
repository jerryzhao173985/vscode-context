import * as vscode from 'vscode';
import * as path from 'path';
import { SmartFileSelector, FileScore } from './smartFileSelection';
import { TokenCounter } from './tokenCounter';

export interface QuickPickFileItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  score?: number;
}

export class QuickPickSelector {
  private smartSelector: SmartFileSelector;
  private tokenCounter: TokenCounter;

  constructor(smartSelector: SmartFileSelector, tokenCounter: TokenCounter) {
    this.smartSelector = smartSelector;
    this.tokenCounter = tokenCounter;
  }

  /**
   * Show quick pick for file selection
   */
  async showFileSelector(context: {
    selectedFiles?: vscode.Uri[];
    openEditors?: vscode.Uri[];
    modifiedFiles?: vscode.Uri[];
    errorFiles?: vscode.Uri[];
  }): Promise<vscode.Uri[] | undefined> {
    const quickPick = vscode.window.createQuickPick<QuickPickFileItem>();

    quickPick.title = 'Select Files for Context';
    quickPick.placeholder = 'Type to search files...';
    quickPick.canSelectMany = true;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    // Show loading
    quickPick.busy = true;
    quickPick.show();

    // Get all workspace files
    const workspaceFiles = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,java,go,rs,c,cpp,h,hpp}',
      '**/node_modules/**'
    );

    // Score files using smart selector
    const scoredFiles = await this.smartSelector.scoreFiles(workspaceFiles, context);

    // Create quick pick items
    const items = await this.createQuickPickItems(scoredFiles, context.selectedFiles || []);

    quickPick.items = items;
    quickPick.selectedItems = items.filter(item =>
      context.selectedFiles?.some(uri => uri.fsPath === item.uri.fsPath)
    );
    quickPick.busy = false;

    // Update on selection change
    quickPick.onDidChangeSelection(async selection => {
      const selectedUris = selection.map(item => item.uri);
      await this.updateSelectionInfo(quickPick, selectedUris);
    });

    return new Promise<vscode.Uri[] | undefined>(resolve => {
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems.map(item => item.uri);
        quickPick.hide();
        resolve(selected);
      });

      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve(undefined);
      });
    });
  }

  /**
   * Create quick pick items from scored files
   */
  private async createQuickPickItems(
    scoredFiles: FileScore[],
    selectedFiles: vscode.Uri[]
  ): Promise<QuickPickFileItem[]> {
    const items: QuickPickFileItem[] = [];
    const selectedPaths = new Set(selectedFiles.map(uri => uri.fsPath));

    for (const scoredFile of scoredFiles) {
      const relativePath = vscode.workspace.asRelativePath(scoredFile.uri);
      const fileName = path.basename(scoredFile.uri.fsPath);
      const dirPath = path.dirname(relativePath);

      // Prepare icons and labels
      const isSelected = selectedPaths.has(scoredFile.uri.fsPath);
      const icon = isSelected ? '$(check)' : '$(file)';
      const scoreIcon = this.getScoreIcon(scoredFile.score);

      const item: QuickPickFileItem = {
        label: `${icon} ${fileName} ${scoreIcon}`,
        description: dirPath,
        detail: scoredFile.reasons.length > 0
          ? scoredFile.reasons.join(' • ')
          : `Score: ${scoredFile.score.toFixed(1)}`,
        uri: scoredFile.uri,
        score: scoredFile.score,
        picked: isSelected
      };

      items.push(item);
    }

    return items;
  }

  private getScoreIcon(score: number): string {
    if (score > 100) return '⭐⭐⭐';
    if (score > 50) return '⭐⭐';
    if (score > 20) return '⭐';
    return '';
  }

  /**
   * Update selection info in quick pick
   */
  private async updateSelectionInfo(
    quickPick: vscode.QuickPick<QuickPickFileItem>,
    selectedUris: vscode.Uri[]
  ): Promise<void> {
    if (selectedUris.length === 0) {
      quickPick.title = 'Select Files for Context';
      return;
    }

    // Calculate tokens for selection
    let totalContent = '';
    for (const uri of selectedUris) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        totalContent += document.getText() + '\n\n';
      } catch (error) {
        // Skip files that can't be read
      }
    }

    const tokens = this.tokenCounter.countTokens(totalContent);
    const tokenText = tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}K`;

    quickPick.title = `Selected: ${selectedUris.length} files • ${tokenText} tokens`;
  }

  /**
   * Show smart suggestions
   */
  async showSmartSuggestions(currentSelection: vscode.Uri[]): Promise<vscode.Uri[] | undefined> {
    const quickPick = vscode.window.createQuickPick<QuickPickFileItem>();

    quickPick.title = 'Smart File Suggestions';
    quickPick.placeholder = 'Select files to add to your context...';
    quickPick.canSelectMany = true;
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    quickPick.busy = true;
    quickPick.show();

    // Get suggestions
    const suggestions = await this.smartSelector.getSuggestedFiles(currentSelection, {}, 20);

    // Create items
    const items: QuickPickFileItem[] = [];

    for (const suggestion of suggestions) {
      const relativePath = vscode.workspace.asRelativePath(suggestion.uri);
      const fileName = path.basename(suggestion.uri.fsPath);
      const dirPath = path.dirname(relativePath);

      const scoreIcon = this.getScoreIcon(suggestion.score);

      items.push({
        label: `${scoreIcon} ${fileName}`,
        description: dirPath,
        detail: suggestion.reasons.join(' • '),
        uri: suggestion.uri,
        score: suggestion.score
      });
    }

    quickPick.items = items;
    quickPick.busy = false;

    return new Promise<vscode.Uri[] | undefined>(resolve => {
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems.map(item => item.uri);
        quickPick.hide();
        resolve(selected);
      });

      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve(undefined);
      });
    });
  }

  /**
   * Show context mode selector
   */
  async showModeSelector(): Promise<'git-changes' | 'current-task' | 'error-focus' | 'full-project' | undefined> {
    const items: Array<vscode.QuickPickItem & { mode: 'git-changes' | 'current-task' | 'error-focus' | 'full-project' }> = [
      {
        label: '$(git-branch) Git Changes',
        description: 'Files modified in Git',
        detail: 'Focus on uncommitted changes',
        mode: 'git-changes'
      },
      {
        label: '$(files) Current Task',
        description: 'Open editors and related files',
        detail: 'Focus on actively edited files',
        mode: 'current-task'
      },
      {
        label: '$(error) Error Focus',
        description: 'Files with errors/warnings',
        detail: 'Focus on files needing attention',
        mode: 'error-focus'
      },
      {
        label: '$(folder-library) Full Project',
        description: 'All source files',
        detail: 'Browse entire project',
        mode: 'full-project'
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select Context Mode',
      placeHolder: 'Choose how to select files...'
    });

    return selected?.mode;
  }

  /**
   * Show template selector
   */
  async showTemplateSelector(): Promise<'debug' | 'review' | 'feature' | undefined> {
    const items: Array<vscode.QuickPickItem & { template: 'debug' | 'review' | 'feature' }> = [
      {
        label: '$(bug) Debug Template',
        description: 'Optimized for debugging',
        detail: 'Git changes + Diagnostics + Related files',
        template: 'debug'
      },
      {
        label: '$(git-pull-request) Review Template',
        description: 'Optimized for code review',
        detail: 'Git diffs + Signatures + Tests',
        template: 'review'
      },
      {
        label: '$(sparkle) Feature Template',
        description: 'Optimized for new features',
        detail: 'Docs + Dependencies + Architecture',
        template: 'feature'
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select Context Template',
      placeHolder: 'Choose a template for your workflow...'
    });

    return selected?.template;
  }

  /**
   * Show category selector (git, errors, etc.)
   */
  async showCategorySelector(): Promise<string | undefined> {
    const items: vscode.QuickPickItem[] = [
      {
        label: '$(git-branch) Modified Files',
        description: 'Files changed in Git',
        detail: 'Show uncommitted changes'
      },
      {
        label: '$(error) Files with Errors',
        description: 'Files with active errors',
        detail: 'Focus on error messages'
      },
      {
        label: '$(warning) Files with Warnings',
        description: 'Files with active warnings',
        detail: 'Focus on warnings'
      },
      {
        label: '$(file) Open Editors',
        description: 'Currently open files',
        detail: 'Files in active editors'
      },
      {
        label: '$(symbol-file) Related Files',
        description: 'Files related to selection',
        detail: 'Imports, tests, types'
      }
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Browse Files by Category',
      placeHolder: 'Select a category...'
    });

    return selected?.label;
  }
}

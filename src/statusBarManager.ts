import * as vscode from 'vscode';
import { TokenCounter, TokenCount } from './tokenCounter';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private tokenCounter: TokenCounter;
  private updateTimer: NodeJS.Timeout | undefined;

  constructor(tokenCounter: TokenCounter) {
    this.tokenCounter = tokenCounter;

    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    this.statusBarItem.command = 'copyContext.showTokenCount';
    this.statusBarItem.tooltip = 'Click to see detailed token count and cost analysis';
  }

  /**
   * Update status bar with token count
   */
  updateTokenCount(selectedFiles: vscode.Uri[]): void {
    // Debounce updates
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    this.updateTimer = setTimeout(async () => {
      await this.performUpdate(selectedFiles);
    }, 300);
  }

  private async performUpdate(selectedFiles: vscode.Uri[]): Promise<void> {
    if (selectedFiles.length === 0) {
      this.statusBarItem.text = '$(files) ContextPack: No files selected';
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.show();
      return;
    }

    try {
      // Read all selected files
      let totalContent = '';
      for (const uri of selectedFiles) {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          totalContent += document.getText() + '\n\n';
        } catch (error) {
          // Skip files that can't be read
        }
      }

      if (totalContent.length === 0) {
        this.statusBarItem.text = `$(files) ${selectedFiles.length} files selected`;
        this.statusBarItem.show();
        return;
      }

      // Count tokens
      const tokenCount = this.tokenCounter.getTokenCount(totalContent);

      // Update status bar text
      this.statusBarItem.text = this.formatStatusBarText(selectedFiles.length, tokenCount);

      // Update background color based on token count
      this.statusBarItem.backgroundColor = this.getBackgroundColor(tokenCount.tokens);

      // Update tooltip
      this.statusBarItem.tooltip = this.formatTooltip(selectedFiles.length, tokenCount);

      this.statusBarItem.show();
    } catch (error) {
      console.error('Error updating status bar:', error);
      this.statusBarItem.text = `$(files) ${selectedFiles.length} files`;
      this.statusBarItem.show();
    }
  }

  private formatStatusBarText(fileCount: number, tokenCount: TokenCount): string {
    const tokens = tokenCount.tokens;

    // Format token count
    let tokenText: string;
    if (tokens < 1000) {
      tokenText = `${tokens}`;
    } else if (tokens < 1000000) {
      tokenText = `${(tokens / 1000).toFixed(1)}K`;
    } else {
      tokenText = `${(tokens / 1000000).toFixed(1)}M`;
    }

    // Get primary cost
    const config = vscode.workspace.getConfiguration('copyContext');
    const models = config.get<string[]>('costModels', ['gpt-4o']);
    const primaryModel = models[0] || 'gpt-4o';

    const pricing = this.tokenCounter.getModelPricing(primaryModel);
    const cost = pricing ? (tokens / 1000000) * pricing.inputCostPerMillion : 0;

    // Format cost
    let costText: string;
    if (cost < 0.01) {
      costText = `$${cost.toFixed(4)}`;
    } else if (cost < 1) {
      costText = `$${cost.toFixed(3)}`;
    } else {
      costText = `$${cost.toFixed(2)}`;
    }

    // Get warning icon if needed
    const warnThreshold = config.get<number>('warnThreshold', 10000);
    const icon = tokens > warnThreshold ? '$(warning)' : '$(files)';

    return `${icon} ${fileCount} files • ${tokenText} tokens • ${costText}`;
  }

  private getBackgroundColor(tokens: number): vscode.ThemeColor | undefined {
    const config = vscode.workspace.getConfiguration('copyContext');
    const warnThreshold = config.get<number>('warnThreshold', 10000);

    if (tokens > warnThreshold * 2) {
      // Red for very high token count
      return new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (tokens > warnThreshold) {
      // Orange for high token count
      return new vscode.ThemeColor('statusBarItem.warningBackground');
    }

    // No special color for normal token count
    return undefined;
  }

  private formatTooltip(fileCount: number, tokenCount: TokenCount): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.supportHtml = true;
    tooltip.isTrusted = true;

    tooltip.appendMarkdown(`**ContextPack-Pro Status**\n\n`);
    tooltip.appendMarkdown(`Files selected: ${fileCount}\n\n`);
    tooltip.appendMarkdown(`Tokens: ${tokenCount.tokens.toLocaleString()}\n\n`);
    tooltip.appendMarkdown(`Characters: ${tokenCount.characters.toLocaleString()}\n\n`);

    tooltip.appendMarkdown(`**Estimated Costs:**\n\n`);

    const sortedCosts = Object.entries(tokenCount.estimatedCost).sort((a, b) => a[1] - b[1]);

    for (const [model, cost] of sortedCosts) {
      const costText = cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`;
      tooltip.appendMarkdown(`- ${model}: ${costText}\n`);
    }

    tooltip.appendMarkdown(`\n*Click to see detailed analysis*`);

    return tooltip;
  }

  /**
   * Show success message with stats
   */
  showCopySuccess(tokenCount: TokenCount, templateName?: string): void {
    const tokens = tokenCount.tokens;
    const tokenText = tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}K`;

    const config = vscode.workspace.getConfiguration('copyContext');
    const models = config.get<string[]>('costModels', ['gpt-4o']);
    const primaryModel = models[0] || 'gpt-4o';

    const pricing = this.tokenCounter.getModelPricing(primaryModel);
    const cost = pricing ? (tokens / 1000000) * pricing.inputCostPerMillion : 0;
    const costText = cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(3)}`;

    const templateText = templateName ? `${templateName} ` : '';
    const message = `${templateText}context copied! ${tokenText} tokens • ${costText}`;

    vscode.window.showInformationMessage(message);
  }

  /**
   * Show warning for large context
   */
  showLargeContextWarning(tokenCount: TokenCount): void {
    const suggestions = this.tokenCounter.getOptimizationSuggestions(tokenCount.tokens);

    if (suggestions.length > 0) {
      const message = suggestions[0];
      vscode.window.showWarningMessage(message, 'Optimize', 'Continue Anyway').then(choice => {
        if (choice === 'Optimize') {
          vscode.commands.executeCommand('copyContext.optimizeContext');
        }
      });
    }
  }

  /**
   * Update with custom message
   */
  updateCustom(text: string, tooltip?: string): void {
    this.statusBarItem.text = text;
    if (tooltip) {
      this.statusBarItem.tooltip = tooltip;
    }
    this.statusBarItem.show();
  }

  /**
   * Show progress during operation
   */
  showProgress(operation: string): void {
    this.statusBarItem.text = `$(sync~spin) ${operation}...`;
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.show();
  }

  /**
   * Show error state
   */
  showError(message: string): void {
    this.statusBarItem.text = `$(error) ${message}`;
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.statusBarItem.show();
  }

  /**
   * Hide status bar
   */
  hide(): void {
    this.statusBarItem.hide();
  }

  /**
   * Show status bar
   */
  show(): void {
    this.statusBarItem.show();
  }

  dispose(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.statusBarItem.dispose();
  }
}

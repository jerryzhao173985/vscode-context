import * as vscode from 'vscode';
import { TokenCounter } from './tokenCounter';

export interface OptimizationSuggestion {
  type: 'remove-file' | 'summarize-file' | 'split-context' | 'filter-content';
  priority: 'high' | 'medium' | 'low';
  fileUri?: vscode.Uri;
  reason: string;
  potentialSavings: number; // tokens saved
  action?: () => Promise<void>;
}

export interface ContextAnalysis {
  totalTokens: number;
  totalFiles: number;
  largestFiles: Array<{ uri: vscode.Uri; tokens: number; percentage: number }>;
  suggestions: OptimizationSuggestion[];
  isOverLimit: boolean;
  targetLimit: number;
  reduceBy: number;
}

export class ContextSizeOptimizer {
  private tokenCounter: TokenCounter;

  constructor(tokenCounter: TokenCounter) {
    this.tokenCounter = tokenCounter;
  }

  /**
   * Analyze current context and provide optimization suggestions
   */
  async analyzeContext(selectedFiles: vscode.Uri[]): Promise<ContextAnalysis> {
    const config = vscode.workspace.getConfiguration('copyContext');
    const targetLimit = config.get<number>('tokenLimit', 200000);

    // Calculate tokens for each file
    const fileTokens: Array<{ uri: vscode.Uri; tokens: number; content: string }> = [];
    let totalTokens = 0;

    for (const uri of selectedFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();
        const tokens = this.tokenCounter.countTokens(content);

        fileTokens.push({ uri, tokens, content });
        totalTokens += tokens;
      } catch (error) {
        console.error(`Error reading file ${uri.fsPath}:`, error);
      }
    }

    // Sort by token count (largest first)
    fileTokens.sort((a, b) => b.tokens - a.tokens);

    // Calculate largest files
    const largestFiles = fileTokens.slice(0, 10).map(f => ({
      uri: f.uri,
      tokens: f.tokens,
      percentage: (f.tokens / totalTokens) * 100
    }));

    // Generate suggestions
    const suggestions = await this.generateSuggestions(
      fileTokens,
      totalTokens,
      targetLimit
    );

    const isOverLimit = totalTokens > targetLimit;
    const reduceBy = Math.max(0, totalTokens - targetLimit);

    return {
      totalTokens,
      totalFiles: selectedFiles.length,
      largestFiles,
      suggestions,
      isOverLimit,
      targetLimit,
      reduceBy
    };
  }

  /**
   * Generate optimization suggestions
   */
  private async generateSuggestions(
    fileTokens: Array<{ uri: vscode.Uri; tokens: number; content: string }>,
    totalTokens: number,
    targetLimit: number
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    if (totalTokens <= targetLimit) {
      return suggestions;
    }

    const tokensToReduce = totalTokens - targetLimit;

    // Strategy 1: Remove largest files that contribute disproportionately
    let tokensRemoved = 0;
    for (const file of fileTokens) {
      const percentage = (file.tokens / totalTokens) * 100;

      // If a single file is >20% of total, suggest removal
      if (percentage > 20) {
        suggestions.push({
          type: 'remove-file',
          priority: 'high',
          fileUri: file.uri,
          reason: `This file accounts for ${percentage.toFixed(1)}% of total tokens`,
          potentialSavings: file.tokens
        });
        tokensRemoved += file.tokens;
      }

      if (tokensRemoved >= tokensToReduce) {
        break;
      }
    }

    // Strategy 2: Suggest summarization for large files
    if (tokensRemoved < tokensToReduce) {
      for (const file of fileTokens) {
        if (file.tokens > 5000) {
          const savings = Math.floor(file.tokens * 0.7); // Assume 70% reduction

          suggestions.push({
            type: 'summarize-file',
            priority: 'medium',
            fileUri: file.uri,
            reason: `Large file (${file.tokens.toLocaleString()} tokens) could be summarized`,
            potentialSavings: savings
          });

          tokensRemoved += savings;

          if (tokensRemoved >= tokensToReduce) {
            break;
          }
        }
      }
    }

    // Strategy 3: Suggest splitting context into multiple parts
    if (tokensRemoved < tokensToReduce && fileTokens.length > 10) {
      suggestions.push({
        type: 'split-context',
        priority: 'medium',
        reason: `Consider splitting ${fileTokens.length} files into smaller, focused contexts`,
        potentialSavings: Math.floor(totalTokens * 0.5)
      });
    }

    // Strategy 4: Filter content (remove comments, whitespace, etc.)
    for (const file of fileTokens.slice(0, 5)) {
      const potentialSavings = this.estimateFilterSavings(file.content);

      if (potentialSavings > 100) {
        suggestions.push({
          type: 'filter-content',
          priority: 'low',
          fileUri: file.uri,
          reason: `Remove comments and extra whitespace`,
          potentialSavings
        });
      }
    }

    // Sort by priority and potential savings
    suggestions.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return b.potentialSavings - a.potentialSavings;
    });

    return suggestions;
  }

  /**
   * Estimate token savings from content filtering
   */
  private estimateFilterSavings(content: string): number {
    // Count comments
    const commentLines = content.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#');
    }).length;

    // Count blank lines
    const blankLines = content.split('\n').filter(line => line.trim() === '').length;

    // Rough estimate: 1 line ≈ 15 tokens
    return (commentLines + blankLines) * 15;
  }

  /**
   * Auto-optimize context by applying best suggestions
   */
  async autoOptimize(
    selectedFiles: vscode.Uri[],
    targetReduction: number
  ): Promise<{ optimizedFiles: vscode.Uri[]; tokensRemoved: number }> {
    const analysis = await this.analyzeContext(selectedFiles);

    let tokensRemoved = 0;
    const filesToRemove = new Set<string>();

    // Apply high-priority suggestions first
    for (const suggestion of analysis.suggestions) {
      if (tokensRemoved >= targetReduction) {
        break;
      }

      if (suggestion.type === 'remove-file' && suggestion.priority === 'high' && suggestion.fileUri) {
        filesToRemove.add(suggestion.fileUri.fsPath);
        tokensRemoved += suggestion.potentialSavings;
      }
    }

    // If still not enough, apply medium-priority suggestions
    if (tokensRemoved < targetReduction) {
      for (const suggestion of analysis.suggestions) {
        if (tokensRemoved >= targetReduction) {
          break;
        }

        if (suggestion.type === 'remove-file' && suggestion.priority === 'medium' && suggestion.fileUri) {
          filesToRemove.add(suggestion.fileUri.fsPath);
          tokensRemoved += suggestion.potentialSavings;
        }
      }
    }

    const optimizedFiles = selectedFiles.filter(uri => !filesToRemove.has(uri.fsPath));

    return {
      optimizedFiles,
      tokensRemoved
    };
  }

  /**
   * Format analysis for display
   */
  formatAnalysis(analysis: ContextAnalysis): string {
    let output = '# Context Size Analysis\n\n';

    // Overall stats
    output += `**Total Tokens:** ${analysis.totalTokens.toLocaleString()}\n`;
    output += `**Total Files:** ${analysis.totalFiles}\n`;
    output += `**Target Limit:** ${analysis.targetLimit.toLocaleString()}\n\n`;

    if (analysis.isOverLimit) {
      output += `⚠️ **Over Limit by ${analysis.reduceBy.toLocaleString()} tokens**\n\n`;
    } else {
      const remaining = analysis.targetLimit - analysis.totalTokens;
      output += `✅ **Within Limit** (${remaining.toLocaleString()} tokens remaining)\n\n`;
    }

    // Largest files
    if (analysis.largestFiles.length > 0) {
      output += '## Largest Files\n\n';
      for (const file of analysis.largestFiles) {
        const relativePath = vscode.workspace.asRelativePath(file.uri);
        output += `- **${relativePath}** - ${file.tokens.toLocaleString()} tokens (${file.percentage.toFixed(1)}%)\n`;
      }
      output += '\n';
    }

    // Suggestions
    if (analysis.suggestions.length > 0) {
      output += '## Optimization Suggestions\n\n';

      const grouped = new Map<string, OptimizationSuggestion[]>();
      for (const suggestion of analysis.suggestions) {
        if (!grouped.has(suggestion.priority)) {
          grouped.set(suggestion.priority, []);
        }
        grouped.get(suggestion.priority)!.push(suggestion);
      }

      for (const [priority, suggestions] of grouped.entries()) {
        const icon = priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢';
        output += `### ${icon} ${priority.toUpperCase()} Priority\n\n`;

        for (const suggestion of suggestions) {
          const relativePath = suggestion.fileUri
            ? vscode.workspace.asRelativePath(suggestion.fileUri)
            : '';

          output += `- **${this.getSuggestionTypeLabel(suggestion.type)}**`;
          if (relativePath) {
            output += ` - ${relativePath}`;
          }
          output += `\n  - ${suggestion.reason}\n`;
          output += `  - Potential savings: ${suggestion.potentialSavings.toLocaleString()} tokens\n\n`;
        }
      }
    } else {
      output += '## ✅ No optimization needed\n\nYour context is already within the recommended size.\n\n';
    }

    return output;
  }

  private getSuggestionTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      'remove-file': 'Remove File',
      'summarize-file': 'Summarize File',
      'split-context': 'Split Context',
      'filter-content': 'Filter Content'
    };
    return labels[type] || type;
  }

  /**
   * Show optimization UI
   */
  async showOptimizationUI(selectedFiles: vscode.Uri[]): Promise<void> {
    const analysis = await this.analyzeContext(selectedFiles);

    if (!analysis.isOverLimit) {
      vscode.window.showInformationMessage(
        `Context size is optimal: ${analysis.totalTokens.toLocaleString()} / ${analysis.targetLimit.toLocaleString()} tokens`
      );
      return;
    }

    const actions: string[] = [];

    if (analysis.suggestions.length > 0) {
      actions.push('View Suggestions');
      actions.push('Auto-Optimize');
    }

    actions.push('Adjust Limit');
    actions.push('Cancel');

    const choice = await vscode.window.showWarningMessage(
      `Context size exceeds limit by ${analysis.reduceBy.toLocaleString()} tokens`,
      ...actions
    );

    switch (choice) {
      case 'View Suggestions':
        await this.showSuggestionsDocument(analysis);
        break;
      case 'Auto-Optimize':
        await this.performAutoOptimize(selectedFiles, analysis.reduceBy);
        break;
      case 'Adjust Limit':
        await this.adjustTokenLimit();
        break;
    }
  }

  private async showSuggestionsDocument(analysis: ContextAnalysis): Promise<void> {
    const content = this.formatAnalysis(analysis);
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown'
    });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private async performAutoOptimize(selectedFiles: vscode.Uri[], targetReduction: number): Promise<void> {
    const result = await this.autoOptimize(selectedFiles, targetReduction);

    vscode.window.showInformationMessage(
      `Optimized context: Removed ${selectedFiles.length - result.optimizedFiles.length} files, ` +
      `saving ${result.tokensRemoved.toLocaleString()} tokens`
    );

    // Fire event to update selection
    // This would be handled by the extension coordinator
  }

  private async adjustTokenLimit(): Promise<void> {
    const config = vscode.workspace.getConfiguration('copyContext');
    const currentLimit = config.get<number>('tokenLimit', 200000);

    const input = await vscode.window.showInputBox({
      prompt: 'Enter new token limit',
      value: currentLimit.toString(),
      validateInput: (value) => {
        const num = parseInt(value);
        if (isNaN(num) || num < 1000) {
          return 'Please enter a valid number (minimum 1000)';
        }
        return null;
      }
    });

    if (input) {
      const newLimit = parseInt(input);
      await config.update('tokenLimit', newLimit, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Token limit updated to ${newLimit.toLocaleString()}`);
    }
  }

  /**
   * Get quick optimization tips
   */
  getOptimizationTips(): string[] {
    return [
      'Focus on files directly related to your task',
      'Exclude test files unless debugging tests',
      'Remove generated or compiled files',
      'Split large refactorings into smaller contexts',
      'Use summarized versions of documentation',
      'Exclude node_modules and vendor directories',
      'Remove commented-out code before including',
      'Consider including only function signatures for large files',
    ];
  }

  dispose(): void {
    // Cleanup if needed
  }
}

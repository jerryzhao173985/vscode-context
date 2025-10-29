import * as vscode from 'vscode';

export type FilterMode =
  | 'full'           // Full file content
  | 'signatures'     // Only function/class signatures
  | 'no-comments'    // Remove comments
  | 'no-tests'       // Remove test code
  | 'lines'          // Specific line ranges
  | 'changed-only';  // Only changed lines (git diff)

export interface FilterOptions {
  mode: FilterMode;
  lineRanges?: Array<{ start: number; end: number }>;
  preserveImports?: boolean;
  preserveExports?: boolean;
  includeDocstrings?: boolean;
}

export interface FilteredContent {
  original: string;
  filtered: string;
  originalTokens: number;
  filteredTokens: number;
  reductionPercentage: number;
  linesRemoved: number;
  description: string;
}

export class ContentFilteringEngine {
  /**
   * Apply filter to file content
   */
  async filterContent(
    uri: vscode.Uri,
    options: FilterOptions,
    tokenCounter: (text: string) => number
  ): Promise<FilteredContent> {
    const document = await vscode.workspace.openTextDocument(uri);
    const original = document.getText();
    const originalTokens = tokenCounter(original);

    let filtered: string;
    let description: string;

    switch (options.mode) {
      case 'full':
        filtered = original;
        description = 'Full content';
        break;

      case 'signatures':
        filtered = this.extractSignatures(original, document.languageId, options);
        description = 'Signatures only';
        break;

      case 'no-comments':
        filtered = this.removeComments(original, document.languageId);
        description = 'Comments removed';
        break;

      case 'no-tests':
        filtered = this.removeTests(original, document.languageId);
        description = 'Test code removed';
        break;

      case 'lines':
        filtered = this.extractLines(original, options.lineRanges || []);
        description = `Selected lines (${options.lineRanges?.length || 0} ranges)`;
        break;

      case 'changed-only':
        filtered = await this.extractChangedLines(uri, original);
        description = 'Changed lines only';
        break;

      default:
        filtered = original;
        description = 'No filtering';
    }

    const filteredTokens = tokenCounter(filtered);
    const originalLines = original.split('\n').length;
    const filteredLines = filtered.split('\n').length;
    const linesRemoved = originalLines - filteredLines;
    const reductionPercentage = ((originalTokens - filteredTokens) / originalTokens) * 100;

    return {
      original,
      filtered,
      originalTokens,
      filteredTokens,
      reductionPercentage,
      linesRemoved,
      description
    };
  }

  /**
   * Extract function and class signatures
   */
  private extractSignatures(
    content: string,
    languageId: string,
    options: FilterOptions
  ): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inMultilineComment = false;
    let indentLevel = 0;
    let captureMode = false;

    // Patterns for different languages
    const patterns = this.getLanguagePatterns(languageId);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Handle multi-line comments
      if (trimmed.includes('/*')) {
        inMultilineComment = true;
      }
      if (trimmed.includes('*/')) {
        inMultilineComment = false;
        continue;
      }
      if (inMultilineComment) {
        continue;
      }

      // Skip single-line comments
      if (patterns.singleLineComment.some(pattern => trimmed.startsWith(pattern))) {
        if (options.includeDocstrings && this.isDocstring(trimmed, languageId)) {
          result.push(line);
        }
        continue;
      }

      // Imports/exports
      if (options.preserveImports && patterns.importPattern.test(trimmed)) {
        result.push(line);
        continue;
      }

      if (options.preserveExports && patterns.exportPattern.test(trimmed)) {
        result.push(line);
        continue;
      }

      // Function/class/interface signatures
      if (patterns.signaturePatterns.some(pattern => pattern.test(trimmed))) {
        captureMode = true;
        indentLevel = this.getIndentLevel(line);
        result.push(line);

        // Check if it's a single-line definition
        if (trimmed.endsWith(';') || trimmed.endsWith('{')) {
          if (trimmed.endsWith('{')) {
            result.push(' '.repeat(indentLevel) + '  // ... implementation ...');
            result.push(' '.repeat(indentLevel) + '}');
          }
          captureMode = false;
        }
        continue;
      }

      // Continue capturing signature until we hit the body
      if (captureMode) {
        result.push(line);
        if (trimmed.endsWith('{') || trimmed.endsWith(';')) {
          if (trimmed.endsWith('{')) {
            result.push(' '.repeat(indentLevel) + '  // ... implementation ...');
            result.push(' '.repeat(indentLevel) + '}');
          }
          captureMode = false;
        }
      }
    }

    return result.join('\n');
  }

  /**
   * Remove comments from content
   */
  private removeComments(content: string, languageId: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inMultilineComment = false;

    const patterns = this.getLanguagePatterns(languageId);

    for (const line of lines) {
      const trimmed = line.trim();

      // Multi-line comments
      if (trimmed.includes('/*')) {
        inMultilineComment = true;
      }
      if (inMultilineComment) {
        if (trimmed.includes('*/')) {
          inMultilineComment = false;
        }
        continue;
      }

      // Single-line comments
      if (patterns.singleLineComment.some(pattern => trimmed.startsWith(pattern))) {
        continue;
      }

      // Remove inline comments
      let cleaned = line;
      for (const pattern of patterns.singleLineComment) {
        const index = cleaned.indexOf(pattern);
        if (index > 0) {
          // Make sure it's not inside a string
          const beforeComment = cleaned.substring(0, index);
          const singleQuotes = (beforeComment.match(/'/g) || []).length;
          const doubleQuotes = (beforeComment.match(/"/g) || []).length;

          // If quotes are balanced, it's a real comment
          if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
            cleaned = beforeComment.trimEnd();
          }
        }
      }

      if (cleaned.trim().length > 0) {
        result.push(cleaned);
      }
    }

    return result.join('\n');
  }

  /**
   * Remove test code
   */
  private removeTests(content: string, languageId: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inTestBlock = false;
    let testIndentLevel = 0;

    const testPatterns = [
      /^\s*test\(/,
      /^\s*it\(/,
      /^\s*describe\(/,
      /^\s*@Test/,
      /^\s*def\s+test_/,
      /^\s*async\s+test\(/,
      /^\s*@pytest\.mark/,
      /^\s*TEST\(/,
      /^\s*TEST_F\(/
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      const currentIndent = this.getIndentLevel(line);

      // Check if we're entering a test block
      if (!inTestBlock && testPatterns.some(pattern => pattern.test(trimmed))) {
        inTestBlock = true;
        testIndentLevel = currentIndent;
        continue;
      }

      // Check if we're exiting a test block
      if (inTestBlock) {
        if (currentIndent <= testIndentLevel && trimmed.length > 0 && !trimmed.startsWith('}')) {
          inTestBlock = false;
        } else {
          continue;
        }
      }

      result.push(line);
    }

    return result.join('\n');
  }

  /**
   * Extract specific line ranges
   */
  private extractLines(
    content: string,
    ranges: Array<{ start: number; end: number }>
  ): string {
    const lines = content.split('\n');
    const result: string[] = [];

    for (const range of ranges) {
      const start = Math.max(0, range.start - 1);
      const end = Math.min(lines.length, range.end);

      for (let i = start; i < end; i++) {
        result.push(lines[i]);
      }

      if (ranges.indexOf(range) < ranges.length - 1) {
        result.push('// ...');
      }
    }

    return result.join('\n');
  }

  /**
   * Extract only changed lines (git diff)
   */
  private async extractChangedLines(uri: vscode.Uri, content: string): Promise<string> {
    // This would integrate with git to get changed lines
    // For now, return full content
    // TODO: Implement git diff integration
    return content;
  }

  /**
   * Get language-specific patterns
   */
  private getLanguagePatterns(languageId: string): {
    singleLineComment: string[];
    importPattern: RegExp;
    exportPattern: RegExp;
    signaturePatterns: RegExp[];
  } {
    const patterns: Record<string, any> = {
      typescript: {
        singleLineComment: ['//', '#'],
        importPattern: /^\s*(import|export\s+\{)/,
        exportPattern: /^\s*export\s+(class|function|interface|type|const|let|var)/,
        signaturePatterns: [
          /^\s*(export\s+)?(class|interface|type|enum)\s+\w+/,
          /^\s*(export\s+)?(async\s+)?function\s+\w+/,
          /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/,
          /^\s*(public|private|protected)\s+\w+\(/
        ]
      },
      javascript: {
        singleLineComment: ['//', '#'],
        importPattern: /^\s*(import|export\s+\{)/,
        exportPattern: /^\s*export\s+(class|function|const|let|var)/,
        signaturePatterns: [
          /^\s*(export\s+)?class\s+\w+/,
          /^\s*(export\s+)?(async\s+)?function\s+\w+/,
          /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/
        ]
      },
      python: {
        singleLineComment: ['#'],
        importPattern: /^\s*(import|from\s+\w+\s+import)/,
        exportPattern: /^\s*__all__\s*=/,
        signaturePatterns: [
          /^\s*class\s+\w+/,
          /^\s*(async\s+)?def\s+\w+/,
          /^\s*@\w+/
        ]
      },
      java: {
        singleLineComment: ['//'],
        importPattern: /^\s*import\s+/,
        exportPattern: /^\s*public\s+(class|interface|enum)/,
        signaturePatterns: [
          /^\s*(public|private|protected)\s+(class|interface|enum)\s+\w+/,
          /^\s*(public|private|protected)\s+(static\s+)?\w+\s+\w+\(/,
          /^\s*@\w+/
        ]
      },
      go: {
        singleLineComment: ['//'],
        importPattern: /^\s*import\s+/,
        exportPattern: /^\s*(func|type|var|const)\s+[A-Z]/,
        signaturePatterns: [
          /^\s*func\s+(\(\w+\s+\*?\w+\)\s+)?\w+/,
          /^\s*type\s+\w+\s+(struct|interface)/
        ]
      }
    };

    return patterns[languageId] || patterns.typescript;
  }

  /**
   * Get indent level of a line
   */
  private getIndentLevel(line: string): number {
    const match = line.match(/^(\s*)/);
    return match ? match[1].length : 0;
  }

  /**
   * Check if comment is a docstring
   */
  private isDocstring(line: string, languageId: string): boolean {
    if (languageId === 'python') {
      return line.startsWith('"""') || line.startsWith("'''");
    }
    if (languageId === 'javascript' || languageId === 'typescript') {
      return line.startsWith('/**');
    }
    if (languageId === 'java') {
      return line.startsWith('/**');
    }
    return false;
  }

  /**
   * Get file preview (first N lines)
   */
  async getPreview(uri: vscode.Uri, lineCount: number = 50): Promise<string> {
    const document = await vscode.workspace.openTextDocument(uri);
    const lines = document.getText().split('\n').slice(0, lineCount);

    let preview = lines.join('\n');
    if (document.lineCount > lineCount) {
      preview += `\n\n... (${document.lineCount - lineCount} more lines)`;
    }

    return preview;
  }

  /**
   * Show filter options UI
   */
  async showFilterOptions(): Promise<FilterOptions | undefined> {
    const modeItems = [
      { label: '📄 Full Content', description: 'Include entire file', mode: 'full' as const },
      { label: '✍️ Signatures Only', description: '~80-90% reduction', mode: 'signatures' as const },
      { label: '🚫 No Comments', description: '~20-40% reduction', mode: 'no-comments' as const },
      { label: '🧪 No Tests', description: 'Remove test code', mode: 'no-tests' as const },
      { label: '📍 Specific Lines', description: 'Select line ranges', mode: 'lines' as const },
      { label: '🔄 Changed Only', description: 'Only modified lines (git diff)', mode: 'changed-only' as const }
    ];

    const selected = await vscode.window.showQuickPick(modeItems, {
      placeHolder: 'Select content filter mode'
    });

    if (!selected) {
      return undefined;
    }

    const options: FilterOptions = {
      mode: selected.mode,
      preserveImports: true,
      preserveExports: true,
      includeDocstrings: true
    };

    // Additional options for signature mode
    if (selected.mode === 'signatures') {
      const additionalOptions = await vscode.window.showQuickPick(
        [
          { label: '✓ Include Imports/Exports', picked: true, option: 'imports' },
          { label: '✓ Include Docstrings', picked: true, option: 'docstrings' }
        ],
        {
          placeHolder: 'Select additional options',
          canPickMany: true
        }
      );

      if (additionalOptions) {
        options.preserveImports = additionalOptions.some(o => o.option === 'imports');
        options.includeDocstrings = additionalOptions.some(o => o.option === 'docstrings');
      }
    }

    // Line ranges for 'lines' mode
    if (selected.mode === 'lines') {
      const rangesInput = await vscode.window.showInputBox({
        prompt: 'Enter line ranges (e.g., 1-10, 25-50, 100-150)',
        placeHolder: '1-10, 25-50',
        validateInput: (value) => {
          if (!value) return 'Line ranges are required';
          if (!/^\d+-\d+(,\s*\d+-\d+)*$/.test(value)) {
            return 'Invalid format. Use: 1-10, 25-50';
          }
          return null;
        }
      });

      if (!rangesInput) {
        return undefined;
      }

      options.lineRanges = rangesInput.split(',').map(range => {
        const [start, end] = range.trim().split('-').map(Number);
        return { start, end };
      });
    }

    return options;
  }

  /**
   * Batch filter multiple files
   */
  async batchFilter(
    files: vscode.Uri[],
    options: FilterOptions,
    tokenCounter: (text: string) => number
  ): Promise<Map<string, FilteredContent>> {
    const results = new Map<string, FilteredContent>();

    for (const uri of files) {
      try {
        const filtered = await this.filterContent(uri, options, tokenCounter);
        results.set(uri.fsPath, filtered);
      } catch (error) {
        console.error(`Error filtering ${uri.fsPath}:`, error);
      }
    }

    return results;
  }

  /**
   * Get filter statistics
   */
  getFilterStats(results: Map<string, FilteredContent>): {
    totalOriginalTokens: number;
    totalFilteredTokens: number;
    totalReduction: number;
    averageReduction: number;
    filesProcessed: number;
  } {
    let totalOriginalTokens = 0;
    let totalFilteredTokens = 0;
    let filesProcessed = 0;

    for (const result of results.values()) {
      totalOriginalTokens += result.originalTokens;
      totalFilteredTokens += result.filteredTokens;
      filesProcessed++;
    }

    const totalReduction = totalOriginalTokens - totalFilteredTokens;
    const averageReduction = filesProcessed > 0 ? (totalReduction / totalOriginalTokens) * 100 : 0;

    return {
      totalOriginalTokens,
      totalFilteredTokens,
      totalReduction,
      averageReduction,
      filesProcessed
    };
  }

  dispose(): void {
    // Cleanup if needed
  }
}

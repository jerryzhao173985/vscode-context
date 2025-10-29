import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import * as path from 'path';

/**
 * Pattern-based file selection
 * Supports glob patterns, regex, and advanced selection strategies
 */
export class PatternSelector {
  /**
   * Select files by glob pattern
   */
  async selectByGlob(pattern: string, exclude?: string[]): Promise<vscode.Uri[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    // Build exclusion pattern
    const excludePattern = exclude?.length
      ? `{${exclude.join(',')}}`
      : '**/node_modules/**';

    const files = await vscode.workspace.findFiles(pattern, excludePattern);
    return files;
  }

  /**
   * Select files by regex pattern
   */
  async selectByRegex(pattern: string): Promise<vscode.Uri[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    // Get all files
    const allFiles = await vscode.workspace.findFiles(
      '**/*',
      '**/node_modules/**'
    );

    // Filter by regex
    const regex = new RegExp(pattern);
    return allFiles.filter(uri => regex.test(uri.fsPath));
  }

  /**
   * Select files by extension
   */
  async selectByExtension(extensions: string[]): Promise<vscode.Uri[]> {
    const patterns = extensions.map(ext => {
      const cleanExt = ext.startsWith('.') ? ext.substring(1) : ext;
      return `**/*.${cleanExt}`;
    });

    const pattern = patterns.length === 1
      ? patterns[0]
      : `{${patterns.join(',')}}`;

    return this.selectByGlob(pattern);
  }

  /**
   * Select files in directory (recursive or not)
   */
  async selectByDirectory(
    dirPath: string,
    recursive: boolean = true
  ): Promise<vscode.Uri[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const relativePath = vscode.workspace.asRelativePath(dirPath);
    const pattern = recursive
      ? `${relativePath}/**/*`
      : `${relativePath}/*`;

    return this.selectByGlob(pattern);
  }

  /**
   * Select files by name pattern (supports wildcards)
   */
  async selectByName(namePattern: string): Promise<vscode.Uri[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const allFiles = await vscode.workspace.findFiles(
      '**/*',
      '**/node_modules/**'
    );

    return allFiles.filter(uri => {
      const basename = path.basename(uri.fsPath);
      return minimatch(basename, namePattern);
    });
  }

  /**
   * Select test files (common patterns)
   */
  async selectTestFiles(): Promise<vscode.Uri[]> {
    const testPatterns = [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.test.js',
      '**/*.test.jsx',
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.spec.js',
      '**/*.spec.jsx',
      '**/__tests__/**/*'
    ];

    const allTests: vscode.Uri[] = [];

    for (const pattern of testPatterns) {
      const files = await this.selectByGlob(pattern);
      allTests.push(...files);
    }

    // Remove duplicates
    const uniqueTests = Array.from(
      new Map(allTests.map(uri => [uri.fsPath, uri])).values()
    );

    return uniqueTests;
  }

  /**
   * Select configuration files
   */
  async selectConfigFiles(): Promise<vscode.Uri[]> {
    const configPatterns = [
      '**/package.json',
      '**/tsconfig.json',
      '**/.eslintrc.*',
      '**/.prettierrc.*',
      '**/jest.config.*',
      '**/webpack.config.*',
      '**/vite.config.*',
      '**/*.config.js',
      '**/*.config.ts'
    ];

    const allConfigs: vscode.Uri[] = [];

    for (const pattern of configPatterns) {
      const files = await this.selectByGlob(pattern);
      allConfigs.push(...files);
    }

    return Array.from(
      new Map(allConfigs.map(uri => [uri.fsPath, uri])).values()
    );
  }

  /**
   * Select files modified in last N days
   */
  async selectRecentlyModified(days: number): Promise<vscode.Uri[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const allFiles = await vscode.workspace.findFiles(
      '**/*',
      '**/node_modules/**'
    );

    const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recentFiles: vscode.Uri[] = [];

    for (const uri of allFiles) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.mtime > cutoffDate) {
          recentFiles.push(uri);
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return recentFiles;
  }

  /**
   * Show interactive pattern selector UI
   */
  async showPatternSelectorUI(): Promise<vscode.Uri[] | undefined> {
    const quickPickItems = [
      {
        label: '$(search) Glob Pattern',
        description: 'Select using glob pattern (e.g., **/*.test.ts)',
        type: 'glob' as const
      },
      {
        label: '$(regex) Regular Expression',
        description: 'Select using regex pattern',
        type: 'regex' as const
      },
      {
        label: '$(symbol-file) File Extension',
        description: 'Select by file extension',
        type: 'extension' as const
      },
      {
        label: '$(folder) Directory',
        description: 'Select entire directory',
        type: 'directory' as const
      },
      {
        label: '$(beaker) Test Files',
        description: 'Select all test files',
        type: 'tests' as const
      },
      {
        label: '$(gear) Config Files',
        description: 'Select configuration files',
        type: 'config' as const
      },
      {
        label: '$(history) Recently Modified',
        description: 'Select recently modified files',
        type: 'recent' as const
      }
    ];

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: 'Select pattern type',
      matchOnDescription: true
    });

    if (!selected) {
      return undefined;
    }

    switch (selected.type) {
      case 'glob': {
        const pattern = await vscode.window.showInputBox({
          prompt: 'Enter glob pattern',
          placeHolder: '**/*.test.ts',
          validateInput: (value) => {
            if (!value) return 'Pattern is required';
            return null;
          }
        });

        if (pattern) {
          return this.selectByGlob(pattern);
        }
        break;
      }

      case 'regex': {
        const pattern = await vscode.window.showInputBox({
          prompt: 'Enter regex pattern',
          placeHolder: '.*Component\\.tsx$',
          validateInput: (value) => {
            if (!value) return 'Pattern is required';
            try {
              new RegExp(value);
              return null;
            } catch (error) {
              return 'Invalid regex pattern';
            }
          }
        });

        if (pattern) {
          return this.selectByRegex(pattern);
        }
        break;
      }

      case 'extension': {
        const extensions = await vscode.window.showInputBox({
          prompt: 'Enter file extensions (comma-separated)',
          placeHolder: '.ts, .tsx, .js',
          validateInput: (value) => {
            if (!value) return 'Extension is required';
            return null;
          }
        });

        if (extensions) {
          const extList = extensions.split(',').map(e => e.trim());
          return this.selectByExtension(extList);
        }
        break;
      }

      case 'directory': {
        const uri = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          openLabel: 'Select Directory'
        });

        if (uri && uri[0]) {
          const recursive = await vscode.window.showQuickPick(
            ['Recursive', 'Current Level Only'],
            { placeHolder: 'Include subdirectories?' }
          );

          // User cancelled the recursive selection
          if (!recursive) {
            return undefined;
          }

          return this.selectByDirectory(
            uri[0].fsPath,
            recursive === 'Recursive'
          );
        }
        break;
      }

      case 'tests': {
        return this.selectTestFiles();
      }

      case 'config': {
        return this.selectConfigFiles();
      }

      case 'recent': {
        const daysInput = await vscode.window.showInputBox({
          prompt: 'Modified in last N days',
          value: '7',
          validateInput: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1) {
              return 'Please enter a valid number of days';
            }
            return null;
          }
        });

        if (daysInput) {
          return this.selectRecentlyModified(parseInt(daysInput));
        }
        break;
      }
    }

    return undefined;
  }

  /**
   * Get selection statistics
   */
  getSelectionStats(files: vscode.Uri[]): {
    total: number;
    byExtension: Map<string, number>;
    byDirectory: Map<string, number>;
  } {
    const byExtension = new Map<string, number>();
    const byDirectory = new Map<string, number>();

    for (const uri of files) {
      // Extension
      const ext = path.extname(uri.fsPath).substring(1) || 'no-extension';
      byExtension.set(ext, (byExtension.get(ext) || 0) + 1);

      // Directory
      const dir = path.dirname(uri.fsPath);
      const relativedir = vscode.workspace.asRelativePath(dir);
      byDirectory.set(relativedir, (byDirectory.get(relativedir) || 0) + 1);
    }

    return {
      total: files.length,
      byExtension,
      byDirectory
    };
  }

  dispose(): void {
    // Cleanup if needed
  }
}

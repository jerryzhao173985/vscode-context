import * as vscode from 'vscode';
import * as path from 'path';

export interface ProjectStructure {
  rootPath: string;
  directories: DirectoryInfo[];
  importantFiles: ImportantFile[];
  structure: string;
  architecture: ProjectArchitecture;
}

export interface DirectoryInfo {
  path: string;
  fileCount: number;
  purpose: string;
}

export interface ImportantFile {
  path: string;
  type: 'config' | 'entry' | 'documentation' | 'schema';
  importance: number;
}

export interface ProjectArchitecture {
  pattern: 'monorepo' | 'microservices' | 'monolith' | 'library' | 'unknown';
  layers: string[];
  conventions: string[];
}

export class ProjectAnalyzer {
  private cache: Map<string, ProjectStructure> = new Map();
  private readonly CACHE_TTL = 120000; // 2 minutes

  constructor() {}

  /**
   * Analyze project structure
   */
  async analyzeProject(): Promise<ProjectStructure | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    const rootPath = workspaceFolder.uri.fsPath;
    const cached = this.cache.get(rootPath);
    if (cached) {
      return cached;
    }

    // Analyze directories
    const directories = await this.analyzeDirectories(rootPath);

    // Find important files
    const importantFiles = await this.findImportantFiles(rootPath);

    // Generate structure tree
    const structure = await this.generateStructureTree(rootPath);

    // Detect architecture pattern
    const architecture = await this.detectArchitecture(rootPath, directories);

    const result: ProjectStructure = {
      rootPath,
      directories,
      importantFiles,
      structure,
      architecture
    };

    this.cache.set(rootPath, result);
    setTimeout(() => this.cache.delete(rootPath), this.CACHE_TTL);

    return result;
  }

  /**
   * Analyze directory structure
   */
  private async analyzeDirectories(rootPath: string): Promise<DirectoryInfo[]> {
    const directories: DirectoryInfo[] = [];

    // Common directory patterns and their purposes
    const directoryPurposes: Record<string, string> = {
      'src': 'Source code',
      'lib': 'Library code',
      'app': 'Application code',
      'components': 'React/UI components',
      'pages': 'Application pages/routes',
      'views': 'View templates',
      'models': 'Data models',
      'controllers': 'Controllers',
      'services': 'Business logic services',
      'utils': 'Utility functions',
      'helpers': 'Helper functions',
      'api': 'API endpoints',
      'routes': 'Route definitions',
      'middleware': 'Middleware functions',
      'hooks': 'Custom hooks',
      'store': 'State management',
      'reducers': 'Redux reducers',
      'actions': 'Redux actions',
      'types': 'Type definitions',
      'interfaces': 'Interface definitions',
      'config': 'Configuration files',
      'public': 'Public assets',
      'static': 'Static assets',
      'assets': 'Asset files',
      'styles': 'Stylesheets',
      'css': 'CSS files',
      'tests': 'Test files',
      '__tests__': 'Test files',
      'spec': 'Specification tests',
      'docs': 'Documentation',
      'scripts': 'Build/utility scripts',
      'tools': 'Development tools',
      'db': 'Database files/migrations',
      'migrations': 'Database migrations',
      'seeds': 'Database seeds',
    };

    // Find all directories
    const allUris = await vscode.workspace.findFiles('**/*', '**/node_modules/**');

    const dirMap = new Map<string, number>();

    for (const uri of allUris) {
      const relativePath = vscode.workspace.asRelativePath(uri);
      const dir = path.dirname(relativePath);

      if (dir !== '.') {
        dirMap.set(dir, (dirMap.get(dir) || 0) + 1);
      }
    }

    // Analyze top-level directories
    for (const [dirPath, fileCount] of dirMap) {
      const parts = dirPath.split(path.sep);
      const topLevel = parts[0];

      // Only include top-level directories
      if (parts.length === 1) {
        const purpose = directoryPurposes[topLevel] || 'Unknown purpose';

        directories.push({
          path: dirPath,
          fileCount,
          purpose
        });
      }
    }

    // Sort by file count
    directories.sort((a, b) => b.fileCount - a.fileCount);

    return directories;
  }

  /**
   * Find important configuration and entry files
   */
  private async findImportantFiles(rootPath: string): Promise<ImportantFile[]> {
    const importantFiles: ImportantFile[] = [];

    const patterns: Array<{ glob: string; type: ImportantFile['type']; importance: number }> = [
      // Configuration files
      { glob: 'package.json', type: 'config', importance: 10 },
      { glob: 'tsconfig.json', type: 'config', importance: 9 },
      { glob: 'vite.config.*', type: 'config', importance: 8 },
      { glob: 'webpack.config.*', type: 'config', importance: 8 },
      { glob: 'next.config.*', type: 'config', importance: 8 },
      { glob: '.env*', type: 'config', importance: 7 },
      { glob: 'docker-compose.yml', type: 'config', importance: 7 },
      { glob: 'Dockerfile', type: 'config', importance: 6 },

      // Entry points
      { glob: 'src/index.*', type: 'entry', importance: 9 },
      { glob: 'src/main.*', type: 'entry', importance: 9 },
      { glob: 'src/app.*', type: 'entry', importance: 8 },
      { glob: 'index.*', type: 'entry', importance: 7 },

      // Documentation
      { glob: 'README.md', type: 'documentation', importance: 8 },
      { glob: 'ARCHITECTURE.md', type: 'documentation', importance: 7 },

      // Schema files
      { glob: 'schema.prisma', type: 'schema', importance: 8 },
      { glob: '**/*.graphql', type: 'schema', importance: 7 },
    ];

    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(pattern.glob, '**/node_modules/**');

      for (const uri of files) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        importantFiles.push({
          path: relativePath,
          type: pattern.type,
          importance: pattern.importance
        });
      }
    }

    // Sort by importance
    importantFiles.sort((a, b) => b.importance - a.importance);

    return importantFiles;
  }

  /**
   * Generate ASCII tree structure
   */
  private async generateStructureTree(rootPath: string): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return '';
    }

    // Get all files
    const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');

    // Build tree structure
    const tree = new Map<string, Set<string>>();

    for (const uri of files) {
      const relativePath = vscode.workspace.asRelativePath(uri);
      const parts = relativePath.split(path.sep);

      for (let i = 0; i < parts.length - 1; i++) {
        const dirPath = parts.slice(0, i + 1).join(path.sep);
        const childPath = parts.slice(0, i + 2).join(path.sep);

        if (!tree.has(dirPath)) {
          tree.set(dirPath, new Set());
        }
        tree.get(dirPath)!.add(childPath);
      }
    }

    // Generate tree string (limited depth)
    const maxDepth = 3;
    let output = '';

    const generateBranch = (dirPath: string, prefix: string, depth: number): void => {
      if (depth > maxDepth) {
        return;
      }

      const children = tree.get(dirPath);
      if (!children) {
        return;
      }

      const childArray = Array.from(children).sort();
      const dirs = childArray.filter(c => tree.has(c));
      const files = childArray.filter(c => !tree.has(c));

      // Show directories first
      for (let i = 0; i < dirs.length; i++) {
        const isLast = i === dirs.length - 1 && files.length === 0;
        const childName = path.basename(dirs[i]);
        output += `${prefix}${isLast ? '└── ' : '├── '}${childName}/\n`;

        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        generateBranch(dirs[i], newPrefix, depth + 1);
      }

      // Then show files (limited)
      const maxFiles = 5;
      const displayFiles = files.slice(0, maxFiles);

      for (let i = 0; i < displayFiles.length; i++) {
        const isLast = i === displayFiles.length - 1;
        const childName = path.basename(displayFiles[i]);
        output += `${prefix}${isLast ? '└── ' : '├── '}${childName}\n`;
      }

      if (files.length > maxFiles) {
        output += `${prefix}    ... and ${files.length - maxFiles} more files\n`;
      }
    };

    output += `${path.basename(rootPath)}/\n`;
    generateBranch('', '', 0);

    return output;
  }

  /**
   * Detect project architecture pattern
   */
  private async detectArchitecture(
    rootPath: string,
    directories: DirectoryInfo[]
  ): Promise<ProjectArchitecture> {
    let pattern: ProjectArchitecture['pattern'] = 'unknown';
    const layers: string[] = [];
    const conventions: string[] = [];

    // Check for monorepo pattern
    const hasPackages = directories.some(d => d.path === 'packages');
    const hasApps = directories.some(d => d.path === 'apps');

    if (hasPackages || hasApps) {
      pattern = 'monorepo';
      conventions.push('Monorepo with multiple packages');
    }

    // Check for microservices pattern
    const hasServices = directories.some(d => d.path === 'services');
    if (hasServices) {
      pattern = 'microservices';
      conventions.push('Microservices architecture');
    }

    // Detect layered architecture
    const hasSrc = directories.some(d => d.path === 'src');
    const hasComponents = directories.some(d => d.path.includes('components'));
    const hasServiceLayer = directories.some(d => d.path.includes('services'));
    const hasModels = directories.some(d => d.path.includes('models'));

    if (hasSrc) {
      layers.push('Source Layer');
    }

    if (hasComponents) {
      layers.push('Presentation Layer');
      conventions.push('Component-based UI');
    }

    if (hasServiceLayer) {
      layers.push('Business Logic Layer');
    }

    if (hasModels) {
      layers.push('Data Layer');
    }

    // Check for library pattern
    const hasLib = directories.some(d => d.path === 'lib');
    if (hasLib && !hasSrc && pattern === 'unknown') {
      pattern = 'library';
    }

    // Default to monolith if not identified
    if (pattern === 'unknown') {
      pattern = 'monolith';
    }

    return {
      pattern,
      layers,
      conventions
    };
  }

  /**
   * Format project structure for display
   */
  formatStructure(structure: ProjectStructure): string {
    let output = '# Project Structure\n\n';

    output += `**Root**: ${path.basename(structure.rootPath)}\n`;
    output += `**Architecture**: ${structure.architecture.pattern}\n\n`;

    if (structure.architecture.layers.length > 0) {
      output += '## Layers\n\n';
      for (const layer of structure.architecture.layers) {
        output += `- ${layer}\n`;
      }
      output += '\n';
    }

    if (structure.architecture.conventions.length > 0) {
      output += '## Conventions\n\n';
      for (const convention of structure.architecture.conventions) {
        output += `- ${convention}\n`;
      }
      output += '\n';
    }

    output += '## Important Files\n\n';
    for (const file of structure.importantFiles.slice(0, 10)) {
      output += `- **${file.path}** (${file.type})\n`;
    }
    output += '\n';

    output += '## Directory Structure\n\n';
    output += '```\n';
    output += structure.structure;
    output += '```\n\n';

    output += '## Key Directories\n\n';
    for (const dir of structure.directories.slice(0, 10)) {
      output += `- **${dir.path}** - ${dir.purpose} (${dir.fileCount} files)\n`;
    }
    output += '\n';

    return output;
  }

  dispose(): void {
    this.cache.clear();
  }
}

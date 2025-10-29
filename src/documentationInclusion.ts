import * as vscode from 'vscode';
import * as path from 'path';

export interface DocumentationFile {
  uri: vscode.Uri;
  type: 'readme' | 'architecture' | 'contributing' | 'changelog' | 'license' | 'api' | 'custom';
  priority: number;
  size: number;
}

export class DocumentationInclusion {
  private cache: Map<string, DocumentationFile[]> = new Map();
  private readonly CACHE_TTL = 60000; // 60 seconds

  constructor() {}

  /**
   * Find all documentation files in workspace
   */
  async findDocumentationFiles(): Promise<DocumentationFile[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const cacheKey = workspaceFolder.uri.fsPath;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const config = vscode.workspace.getConfiguration('copyContext');
    const customPatterns = config.get<string[]>('docFilePatterns', [
      'README.md',
      '**/ARCHITECTURE.md',
      '**/CONTRIBUTING.md'
    ]);

    const docFiles: DocumentationFile[] = [];

    // Standard documentation patterns
    const standardPatterns = [
      { pattern: '**/README.md', type: 'readme' as const, priority: 10 },
      { pattern: '**/README.txt', type: 'readme' as const, priority: 9 },
      { pattern: '**/ARCHITECTURE.md', type: 'architecture' as const, priority: 8 },
      { pattern: '**/DESIGN.md', type: 'architecture' as const, priority: 7 },
      { pattern: '**/CONTRIBUTING.md', type: 'contributing' as const, priority: 6 },
      { pattern: '**/CHANGELOG.md', type: 'changelog' as const, priority: 5 },
      { pattern: '**/LICENSE', type: 'license' as const, priority: 4 },
      { pattern: '**/LICENSE.md', type: 'license' as const, priority: 4 },
      { pattern: '**/API.md', type: 'api' as const, priority: 7 },
      { pattern: '**/DOCS.md', type: 'api' as const, priority: 6 },
    ];

    // Find all standard documentation files
    for (const { pattern, type, priority } of standardPatterns) {
      try {
        const files = await vscode.workspace.findFiles(
          pattern,
          '**/node_modules/**'
        );

        for (const uri of files) {
          const stats = await vscode.workspace.fs.stat(uri);
          docFiles.push({
            uri,
            type,
            priority,
            size: stats.size
          });
        }
      } catch (error) {
        // Continue if pattern fails
      }
    }

    // Find custom pattern files
    for (const pattern of customPatterns) {
      try {
        const files = await vscode.workspace.findFiles(
          pattern,
          '**/node_modules/**'
        );

        for (const uri of files) {
          // Check if not already added
          if (!docFiles.find(df => df.uri.fsPath === uri.fsPath)) {
            const stats = await vscode.workspace.fs.stat(uri);
            docFiles.push({
              uri,
              type: 'custom',
              priority: 5,
              size: stats.size
            });
          }
        }
      } catch (error) {
        // Continue if pattern fails
      }
    }

    // Sort by priority (higher first)
    docFiles.sort((a, b) => b.priority - a.priority);

    // Cache results
    this.cache.set(cacheKey, docFiles);
    setTimeout(() => this.cache.delete(cacheKey), this.CACHE_TTL);

    return docFiles;
  }

  /**
   * Get relevant documentation for selected files
   */
  async getRelevantDocumentation(selectedFiles: vscode.Uri[]): Promise<DocumentationFile[]> {
    const allDocs = await this.findDocumentationFiles();

    if (selectedFiles.length === 0) {
      // Return top priority docs
      return allDocs.slice(0, 3);
    }

    // Get workspace-relative paths of selected files
    const selectedPaths = selectedFiles.map(uri =>
      vscode.workspace.asRelativePath(uri)
    );

    // Find docs in same directories as selected files
    const relevantDocs: DocumentationFile[] = [];
    const selectedDirs = new Set(
      selectedPaths.map(p => path.dirname(p))
    );

    for (const doc of allDocs) {
      const docDir = path.dirname(vscode.workspace.asRelativePath(doc.uri));

      // Check if doc is in same directory or parent directory
      for (const selectedDir of selectedDirs) {
        if (
          selectedDir === docDir ||
          selectedDir.startsWith(docDir + '/') ||
          docDir === '.'
        ) {
          relevantDocs.push(doc);
          break;
        }
      }
    }

    // Always include root README if it exists
    const rootReadme = allDocs.find(doc =>
      doc.type === 'readme' &&
      path.dirname(vscode.workspace.asRelativePath(doc.uri)) === '.'
    );

    if (rootReadme && !relevantDocs.includes(rootReadme)) {
      relevantDocs.unshift(rootReadme);
    }

    return relevantDocs;
  }

  /**
   * Format documentation files for context
   */
  async formatDocumentation(docFiles: DocumentationFile[]): Promise<string> {
    if (docFiles.length === 0) {
      return '';
    }

    let output = '# Documentation\n\n';

    for (const doc of docFiles) {
      const relativePath = vscode.workspace.asRelativePath(doc.uri);

      try {
        const document = await vscode.workspace.openTextDocument(doc.uri);
        const content = document.getText();

        // Limit documentation size (max 10KB per file)
        const maxSize = 10 * 1024;
        const truncated = content.length > maxSize;
        const displayContent = truncated
          ? content.substring(0, maxSize) + '\n\n... (truncated)'
          : content;

        output += `## ${relativePath}\n\n`;
        output += `${displayContent}\n\n`;
        output += '---\n\n';
      } catch (error) {
        console.error(`Error reading documentation file ${doc.uri.fsPath}:`, error);
      }
    }

    return output;
  }

  /**
   * Get documentation summary
   */
  async getSummary(): Promise<string> {
    const docs = await this.findDocumentationFiles();

    if (docs.length === 0) {
      return 'No documentation files found.';
    }

    let output = '# Available Documentation\n\n';

    const grouped = new Map<string, DocumentationFile[]>();
    for (const doc of docs) {
      if (!grouped.has(doc.type)) {
        grouped.set(doc.type, []);
      }
      grouped.get(doc.type)!.push(doc);
    }

    for (const [type, files] of grouped.entries()) {
      output += `## ${this.getTypeLabel(type)} (${files.length})\n\n`;
      for (const file of files) {
        const relativePath = vscode.workspace.asRelativePath(file.uri);
        const sizeKB = (file.size / 1024).toFixed(1);
        output += `- **${relativePath}** (${sizeKB} KB)\n`;
      }
      output += '\n';
    }

    return output;
  }

  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      'readme': '📖 README Files',
      'architecture': '🏗️ Architecture Docs',
      'contributing': '🤝 Contributing Guides',
      'changelog': '📝 Changelogs',
      'license': '⚖️ License Files',
      'api': '📚 API Documentation',
      'custom': '📄 Custom Docs'
    };

    return labels[type] || type;
  }

  /**
   * Check if documentation should be included
   */
  shouldIncludeDocumentation(): boolean {
    const config = vscode.workspace.getConfiguration('copyContext');
    return config.get<boolean>('includeDocFiles', true);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.cache.clear();
  }
}

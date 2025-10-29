import * as vscode from 'vscode';
import * as path from 'path';

export type RelationshipType = 'imports' | 'tests' | 'types' | 'used-by';

export interface FileRelationship {
  file: vscode.Uri;
  type: RelationshipType;
  confidence: number;
  reason: string;
}

export interface RelationshipConfig {
  types: RelationshipType[];
  maxFiles: number;
  confidenceThreshold: number;
}

export class FileRelationshipAnalyzer {
  private cache: Map<string, FileRelationship[]> = new Map();
  private readonly CACHE_TTL = 10000; // 10 seconds

  constructor() {}

  /**
   * Find related files for a given file
   */
  async findRelatedFiles(
    uri: vscode.Uri,
    config: RelationshipConfig
  ): Promise<FileRelationship[]> {
    const cacheKey = uri.fsPath;
    const cached = this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const relationships: FileRelationship[] = [];

    // Check each relationship type
    for (const type of config.types) {
      switch (type) {
        case 'imports':
          relationships.push(...(await this.findImportedFiles(uri)));
          break;
        case 'tests':
          relationships.push(...(await this.findTestFiles(uri)));
          break;
        case 'types':
          relationships.push(...(await this.findTypeFiles(uri)));
          break;
        case 'used-by':
          relationships.push(...(await this.findUsages(uri)));
          break;
      }
    }

    // Filter by confidence threshold
    const filtered = relationships
      .filter(r => r.confidence >= config.confidenceThreshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, config.maxFiles);

    // Cache results
    this.cache.set(cacheKey, filtered);
    setTimeout(() => this.cache.delete(cacheKey), this.CACHE_TTL);

    return filtered;
  }

  /**
   * Find files imported by the given file
   */
  private async findImportedFiles(uri: vscode.Uri): Promise<FileRelationship[]> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const text = document.getText();
      const relationships: FileRelationship[] = [];

      // TypeScript/JavaScript imports
      const importPatterns = [
        // ES6 imports: import { x } from './file'
        /import\s+(?:{[^}]+}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g,
        // CommonJS: require('./file')
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        // Dynamic imports: import('./file')
        /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      ];

      for (const pattern of importPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
          const importPath = match[1];
          const resolvedUri = await this.resolveImport(uri, importPath);

          if (resolvedUri) {
            relationships.push({
              file: resolvedUri,
              type: 'imports',
              confidence: 0.9,
              reason: `Imported by ${path.basename(uri.fsPath)}`
            });
          }
        }
      }

      return relationships;
    } catch (error) {
      console.error('Error finding imports:', error);
      return [];
    }
  }

  /**
   * Find test files for the given file
   */
  private async findTestFiles(uri: vscode.Uri): Promise<FileRelationship[]> {
    const fileName = path.basename(uri.fsPath);
    const fileDir = path.dirname(uri.fsPath);
    const fileBase = fileName.replace(/\.(ts|js|tsx|jsx)$/, '');

    const testPatterns = [
      // Same directory
      `${fileBase}.test.{ts,tsx,js,jsx}`,
      `${fileBase}.spec.{ts,tsx,js,jsx}`,
      // __tests__ directory
      `__tests__/${fileBase}.test.{ts,tsx,js,jsx}`,
      `__tests__/${fileBase}.spec.{ts,tsx,js,jsx}`,
      // tests directory
      `tests/${fileBase}.test.{ts,tsx,js,jsx}`,
      `tests/${fileBase}.spec.{ts,tsx,js,jsx}`,
    ];

    const relationships: FileRelationship[] = [];

    for (const pattern of testPatterns) {
      const fullPattern = path.join(fileDir, pattern);
      const files = await vscode.workspace.findFiles(
        fullPattern,
        '**/node_modules/**'
      );

      for (const file of files) {
        relationships.push({
          file,
          type: 'tests',
          confidence: 0.95,
          reason: `Test file for ${fileName}`
        });
      }
    }

    return relationships;
  }

  /**
   * Find type definition files
   */
  private async findTypeFiles(uri: vscode.Uri): Promise<FileRelationship[]> {
    const fileName = path.basename(uri.fsPath);
    const fileDir = path.dirname(uri.fsPath);
    const fileBase = fileName.replace(/\.(ts|js|tsx|jsx)$/, '');

    const typePatterns = [
      // Type files
      `${fileBase}.types.ts`,
      `${fileBase}.d.ts`,
      // Types directory
      `types/${fileBase}.ts`,
      `types/${fileBase}.d.ts`,
      // @types
      `@types/${fileBase}.ts`,
    ];

    const relationships: FileRelationship[] = [];

    for (const pattern of typePatterns) {
      const fullPattern = path.join(fileDir, pattern);
      const files = await vscode.workspace.findFiles(
        fullPattern,
        '**/node_modules/**'
      );

      for (const file of files) {
        relationships.push({
          file,
          type: 'types',
          confidence: 0.9,
          reason: `Type definitions for ${fileName}`
        });
      }
    }

    return relationships;
  }

  /**
   * Find files that use/import the given file
   */
  private async findUsages(uri: vscode.Uri): Promise<FileRelationship[]> {
    const relativePath = vscode.workspace.asRelativePath(uri);
    const fileName = path.basename(uri.fsPath, path.extname(uri.fsPath));

    // Search workspace for files that import this file
    const searchPattern = new RegExp(
      `(from|require)\\s*['"\`][^'"\`]*${fileName}[^'"\`]*['"\`]`,
      'g'
    );

    const relationships: FileRelationship[] = [];

    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        return relationships;
      }

      // Find all JS/TS files in workspace
      const files = await vscode.workspace.findFiles(
        '**/*.{ts,tsx,js,jsx}',
        '**/node_modules/**'
      );

      // Limit search to prevent performance issues
      const maxFilesToSearch = 100;
      const filesToSearch = files.slice(0, maxFilesToSearch);

      for (const file of filesToSearch) {
        if (file.fsPath === uri.fsPath) {
          continue; // Skip self
        }

        try {
          const document = await vscode.workspace.openTextDocument(file);
          const text = document.getText();

          if (searchPattern.test(text)) {
            relationships.push({
              file,
              type: 'used-by',
              confidence: 0.85,
              reason: `Imports ${path.basename(uri.fsPath)}`
            });
          }
        } catch (error) {
          // Skip files that can't be read
        }
      }
    } catch (error) {
      console.error('Error finding usages:', error);
    }

    return relationships;
  }

  /**
   * Resolve import path to actual file URI
   */
  private async resolveImport(
    fromUri: vscode.Uri,
    importPath: string
  ): Promise<vscode.Uri | null> {
    // Skip node_modules and external packages
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
      return null;
    }

    const fromDir = path.dirname(fromUri.fsPath);
    let resolvedPath = path.resolve(fromDir, importPath);

    // Try different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts', ''];
    const indexFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];

    // Try with extensions
    for (const ext of extensions) {
      const pathWithExt = resolvedPath + ext;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(pathWithExt));
        return vscode.Uri.file(pathWithExt);
      } catch {
        // File doesn't exist, try next
      }
    }

    // Try as directory with index file
    for (const indexFile of indexFiles) {
      const indexPath = path.join(resolvedPath, indexFile);
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(indexPath));
        return vscode.Uri.file(indexPath);
      } catch {
        // File doesn't exist, try next
      }
    }

    return null;
  }

  /**
   * Get all relationships for multiple files
   */
  async findRelatedFilesForMultiple(
    uris: vscode.Uri[],
    config: RelationshipConfig
  ): Promise<Map<string, FileRelationship[]>> {
    const results = new Map<string, FileRelationship[]>();

    for (const uri of uris) {
      const relationships = await this.findRelatedFiles(uri, config);
      results.set(uri.fsPath, relationships);
    }

    return results;
  }

  /**
   * Get unique related files from all relationships
   */
  getUniqueRelatedFiles(
    relationshipsMap: Map<string, FileRelationship[]>
  ): vscode.Uri[] {
    const uniqueFiles = new Set<string>();

    for (const relationships of relationshipsMap.values()) {
      for (const rel of relationships) {
        uniqueFiles.add(rel.file.fsPath);
      }
    }

    return Array.from(uniqueFiles).map(fsPath => vscode.Uri.file(fsPath));
  }

  /**
   * Format relationships for display
   */
  formatRelationships(relationships: FileRelationship[]): string {
    if (relationships.length === 0) {
      return 'No related files found.';
    }

    let output = '## Related Files\n\n';

    const grouped = new Map<RelationshipType, FileRelationship[]>();
    for (const rel of relationships) {
      if (!grouped.has(rel.type)) {
        grouped.set(rel.type, []);
      }
      grouped.get(rel.type)!.push(rel);
    }

    for (const [type, rels] of grouped.entries()) {
      output += `### ${this.getTypeLabel(type)} (${rels.length})\n\n`;
      for (const rel of rels) {
        const fileName = path.basename(rel.file.fsPath);
        const confidence = Math.round(rel.confidence * 100);
        output += `- \`${fileName}\` (${confidence}% confidence) - ${rel.reason}\n`;
      }
      output += '\n';
    }

    return output;
  }

  private getTypeLabel(type: RelationshipType): string {
    switch (type) {
      case 'imports':
        return '📦 Imported Files';
      case 'tests':
        return '🧪 Test Files';
      case 'types':
        return '📘 Type Definitions';
      case 'used-by':
        return '🔗 Used By';
      default:
        return type;
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.cache.clear();
  }
}

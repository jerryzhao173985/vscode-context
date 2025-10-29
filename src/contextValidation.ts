import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { FileRelationshipAnalyzer } from './fileRelationships';

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  type: 'stale' | 'missing-dependency' | 'circular-dependency' | 'too-large' | 'test-only' | 'generated' | 'outdated';
  file?: vscode.Uri;
  message: string;
  suggestion?: string;
  autoFixable?: boolean;
}

export interface HealthScore {
  overall: number; // 0-100
  categories: {
    freshness: number;
    completeness: number;
    quality: number;
    size: number;
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface ValidationReport {
  healthScore: HealthScore;
  issues: ValidationIssue[];
  recommendations: string[];
  timestamp: number;
}

export class ContextValidator {
  private relationshipAnalyzer: FileRelationshipAnalyzer;

  constructor(relationshipAnalyzer: FileRelationshipAnalyzer) {
    this.relationshipAnalyzer = relationshipAnalyzer;
  }

  /**
   * Validate context and generate health report
   */
  async validateContext(
    files: vscode.Uri[],
    options?: {
      checkStale?: boolean;
      checkDependencies?: boolean;
      checkCircular?: boolean;
      checkSize?: boolean;
      staleDays?: number;
    }
  ): Promise<ValidationReport> {
    const opts = {
      checkStale: true,
      checkDependencies: true,
      checkCircular: true,
      checkSize: true,
      staleDays: 30,
      ...options
    };

    const issues: ValidationIssue[] = [];

    // Run all checks
    if (opts.checkStale) {
      issues.push(...(await this.checkStaleFiles(files, opts.staleDays)));
    }

    if (opts.checkDependencies) {
      issues.push(...(await this.checkMissingDependencies(files)));
    }

    if (opts.checkCircular) {
      issues.push(...(await this.checkCircularDependencies(files)));
    }

    if (opts.checkSize) {
      issues.push(...(await this.checkFileSize(files)));
    }

    // Check for test-only files
    issues.push(...(await this.checkTestOnlyFiles(files)));

    // Check for generated files
    issues.push(...(await this.checkGeneratedFiles(files)));

    // Calculate health score
    const healthScore = this.calculateHealthScore(files, issues);

    // Generate recommendations
    const recommendations = this.generateRecommendations(files, issues, healthScore);

    return {
      healthScore,
      issues,
      recommendations,
      timestamp: Date.now()
    };
  }

  /**
   * Check for stale files (not modified recently)
   */
  private async checkStaleFiles(files: vscode.Uri[], staleDays: number): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const staleThreshold = Date.now() - (staleDays * 24 * 60 * 60 * 1000);

    for (const uri of files) {
      try {
        const stats = await fs.stat(uri.fsPath);
        const lastModified = stats.mtimeMs;

        if (lastModified < staleThreshold) {
          const daysOld = Math.floor((Date.now() - lastModified) / (24 * 60 * 60 * 1000));

          issues.push({
            severity: daysOld > 90 ? 'warning' : 'info',
            type: 'stale',
            file: uri,
            message: `File not modified in ${daysOld} days`,
            suggestion: 'Consider if this file is still relevant to your current task',
            autoFixable: true
          });
        }
      } catch (error) {
        // File doesn't exist or can't be accessed
        issues.push({
          severity: 'error',
          type: 'missing-dependency',
          file: uri,
          message: 'File not found or inaccessible',
          suggestion: 'Remove this file from context',
          autoFixable: true
        });
      }
    }

    return issues;
  }

  /**
   * Check for missing dependencies
   */
  private async checkMissingDependencies(files: vscode.Uri[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const fileSet = new Set(files.map(uri => uri.fsPath));

    for (const uri of files) {
      try {
        const relationships = await this.relationshipAnalyzer.findRelatedFiles(uri, {
          types: ['imports'],
          maxFiles: 100,
          confidenceThreshold: 0.8
        });

        const missingImports = relationships.filter(
          rel => !fileSet.has(rel.file.fsPath) && rel.type === 'imports'
        );

        if (missingImports.length > 0) {
          const topMissing = missingImports.slice(0, 3);
          const fileNames = topMissing.map(r => vscode.workspace.asRelativePath(r.file)).join(', ');

          issues.push({
            severity: 'warning',
            type: 'missing-dependency',
            file: uri,
            message: `Missing ${missingImports.length} imported file(s): ${fileNames}${missingImports.length > 3 ? '...' : ''}`,
            suggestion: 'Add these files to context for better AI understanding',
            autoFixable: true
          });
        }
      } catch (error) {
        // Skip files that can't be analyzed
      }
    }

    return issues;
  }

  /**
   * Check for circular dependencies
   */
  private async checkCircularDependencies(files: vscode.Uri[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const graph = new Map<string, Set<string>>();

    // Build dependency graph
    for (const uri of files) {
      try {
        const relationships = await this.relationshipAnalyzer.findRelatedFiles(uri, {
          types: ['imports'],
          maxFiles: 100,
          confidenceThreshold: 0.8
        });

        const deps = new Set<string>();
        for (const rel of relationships) {
          if (files.some(f => f.fsPath === rel.file.fsPath)) {
            deps.add(rel.file.fsPath);
          }
        }

        graph.set(uri.fsPath, deps);
      } catch (error) {
        // Skip
      }
    }

    // Detect cycles
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string, path: string[]): string[] | null => {
      visited.add(node);
      recursionStack.add(node);

      const deps = graph.get(node) || new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          const cyclePath = hasCycle(dep, [...path, dep]);
          if (cyclePath) {
            return cyclePath;
          }
        } else if (recursionStack.has(dep)) {
          // Found cycle
          return [...path, dep];
        }
      }

      recursionStack.delete(node);
      return null;
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        const cyclePath = hasCycle(node, [node]);
        if (cyclePath) {
          const cycleFiles = cyclePath.map(f => vscode.workspace.asRelativePath(f)).join(' → ');

          issues.push({
            severity: 'warning',
            type: 'circular-dependency',
            message: `Circular dependency detected: ${cycleFiles}`,
            suggestion: 'Consider refactoring to break the circular dependency',
            autoFixable: false
          });

          break; // Report first cycle only
        }
      }
    }

    return issues;
  }

  /**
   * Check file sizes
   */
  private async checkFileSize(files: vscode.Uri[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const LARGE_FILE_THRESHOLD = 1024 * 1024; // 1MB
    const VERY_LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB

    for (const uri of files) {
      try {
        const stats = await fs.stat(uri.fsPath);

        if (stats.size > VERY_LARGE_FILE_THRESHOLD) {
          issues.push({
            severity: 'error',
            type: 'too-large',
            file: uri,
            message: `Very large file (${this.formatSize(stats.size)})`,
            suggestion: 'Consider using content filtering or excluding this file',
            autoFixable: true
          });
        } else if (stats.size > LARGE_FILE_THRESHOLD) {
          issues.push({
            severity: 'warning',
            type: 'too-large',
            file: uri,
            message: `Large file (${this.formatSize(stats.size)})`,
            suggestion: 'Consider using signature-only mode for this file',
            autoFixable: true
          });
        }
      } catch (error) {
        // Skip
      }
    }

    return issues;
  }

  /**
   * Check for test-only context
   */
  private async checkTestOnlyFiles(files: vscode.Uri[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    const testFiles = files.filter(uri => {
      const path = uri.fsPath.toLowerCase();
      return path.includes('/test/') ||
             path.includes('/__tests__/') ||
             path.includes('.test.') ||
             path.includes('.spec.');
    });

    if (testFiles.length === files.length && files.length > 0) {
      issues.push({
        severity: 'warning',
        type: 'test-only',
        message: 'Context contains only test files',
        suggestion: 'Include source files being tested for better context',
        autoFixable: false
      });
    }

    return issues;
  }

  /**
   * Check for generated files
   */
  private async checkGeneratedFiles(files: vscode.Uri[]): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    for (const uri of files) {
      const isGenerated = await this.isGeneratedFile(uri);

      if (isGenerated) {
        issues.push({
          severity: 'info',
          type: 'generated',
          file: uri,
          message: 'File appears to be generated',
          suggestion: 'Generated files may not be useful for AI context',
          autoFixable: true
        });
      }
    }

    return issues;
  }

  /**
   * Check if file is generated
   */
  private async isGeneratedFile(uri: vscode.Uri): Promise<boolean> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const firstLines = document.getText().split('\n').slice(0, 10).join('\n').toLowerCase();

      // Common generated file markers
      const generatedMarkers = [
        'auto-generated',
        'autogenerated',
        'do not edit',
        'generated by',
        'this file is generated',
        '@generated',
        'code generated by',
        'automatically generated'
      ];

      return generatedMarkers.some(marker => firstLines.includes(marker));
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate health score
   */
  private calculateHealthScore(files: vscode.Uri[], issues: ValidationIssue[]): HealthScore {
    // Freshness score (based on stale files)
    const staleIssues = issues.filter(i => i.type === 'stale');
    const freshness = Math.max(0, 100 - (staleIssues.length / files.length) * 100);

    // Completeness score (based on missing dependencies)
    const missingDeps = issues.filter(i => i.type === 'missing-dependency');
    const completeness = Math.max(0, 100 - (missingDeps.length / files.length) * 50);

    // Quality score (based on errors and warnings)
    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const quality = Math.max(0, 100 - (errors * 20 + warnings * 10));

    // Size score (based on file sizes)
    const sizeIssues = issues.filter(i => i.type === 'too-large');
    const size = Math.max(0, 100 - (sizeIssues.length / files.length) * 100);

    // Overall score
    const overall = (freshness + completeness + quality + size) / 4;

    // Grade
    let grade: HealthScore['grade'];
    if (overall >= 90) grade = 'A';
    else if (overall >= 80) grade = 'B';
    else if (overall >= 70) grade = 'C';
    else if (overall >= 60) grade = 'D';
    else grade = 'F';

    return {
      overall: Math.round(overall),
      categories: {
        freshness: Math.round(freshness),
        completeness: Math.round(completeness),
        quality: Math.round(quality),
        size: Math.round(size)
      },
      grade
    };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    files: vscode.Uri[],
    issues: ValidationIssue[],
    healthScore: HealthScore
  ): string[] {
    const recommendations: string[] = [];

    // Based on health score
    if (healthScore.categories.freshness < 70) {
      recommendations.push('Remove or update stale files that haven\'t been modified recently');
    }

    if (healthScore.categories.completeness < 70) {
      recommendations.push('Add missing dependencies to provide complete context');
    }

    if (healthScore.categories.quality < 70) {
      recommendations.push('Address errors and warnings to improve context quality');
    }

    if (healthScore.categories.size < 70) {
      recommendations.push('Use content filtering for large files to reduce token usage');
    }

    // Based on issues
    const autoFixable = issues.filter(i => i.autoFixable);
    if (autoFixable.length > 0) {
      recommendations.push(`${autoFixable.length} issues can be auto-fixed - click "Auto-Fix" to resolve them`);
    }

    const circularDeps = issues.filter(i => i.type === 'circular-dependency');
    if (circularDeps.length > 0) {
      recommendations.push('Consider refactoring to break circular dependencies');
    }

    const testOnly = issues.find(i => i.type === 'test-only');
    if (testOnly) {
      recommendations.push('Include source files to provide implementation context');
    }

    // General recommendations
    if (files.length > 50) {
      recommendations.push('Large context detected - consider splitting into multiple focused contexts');
    }

    if (files.length < 3) {
      recommendations.push('Small context - consider adding related files for better AI understanding');
    }

    return recommendations;
  }

  /**
   * Auto-fix issues
   */
  async autoFix(
    files: vscode.Uri[],
    issues: ValidationIssue[]
  ): Promise<{ fixed: number; remaining: vscode.Uri[] }> {
    const filesToRemove = new Set<string>();
    let fixed = 0;

    for (const issue of issues) {
      if (!issue.autoFixable || !issue.file) {
        continue;
      }

      switch (issue.type) {
        case 'stale':
        case 'generated':
        case 'too-large':
          // Remove problematic files
          filesToRemove.add(issue.file.fsPath);
          fixed++;
          break;

        case 'missing-dependency':
          // Files that don't exist should be removed
          if (issue.message.includes('not found')) {
            filesToRemove.add(issue.file.fsPath);
            fixed++;
          }
          break;
      }
    }

    const remaining = files.filter(uri => !filesToRemove.has(uri.fsPath));

    return { fixed, remaining };
  }

  /**
   * Format validation report
   */
  formatReport(report: ValidationReport): string {
    const output: string[] = [];

    output.push('# Context Health Report\n');
    output.push(`**Overall Health:** ${report.healthScore.overall}/100 (Grade ${report.healthScore.grade})\n`);

    // Category scores
    output.push('## Score Breakdown\n');
    output.push(`- 🔄 Freshness: ${report.healthScore.categories.freshness}/100`);
    output.push(`- ✅ Completeness: ${report.healthScore.categories.completeness}/100`);
    output.push(`- ⭐ Quality: ${report.healthScore.categories.quality}/100`);
    output.push(`- 📊 Size: ${report.healthScore.categories.size}/100\n`);

    // Issues
    if (report.issues.length > 0) {
      output.push(`## Issues Found (${report.issues.length})\n`);

      const grouped = new Map<string, ValidationIssue[]>();
      for (const issue of report.issues) {
        const key = issue.severity;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(issue);
      }

      for (const [severity, issues] of grouped.entries()) {
        const icon = severity === 'error' ? '❌' : severity === 'warning' ? '⚠️' : 'ℹ️';
        output.push(`### ${icon} ${severity.toUpperCase()} (${issues.length})\n`);

        for (const issue of issues.slice(0, 10)) {
          if (issue.file) {
            const relativePath = vscode.workspace.asRelativePath(issue.file);
            output.push(`- **${relativePath}**: ${issue.message}`);
          } else {
            output.push(`- ${issue.message}`);
          }
          if (issue.suggestion) {
            output.push(`  - 💡 ${issue.suggestion}`);
          }
        }

        if (issues.length > 10) {
          output.push(`  ... and ${issues.length - 10} more\n`);
        }
        output.push('');
      }
    } else {
      output.push('## ✅ No Issues Found\n');
      output.push('Your context is healthy!\n');
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      output.push('## 💡 Recommendations\n');
      for (const rec of report.recommendations) {
        output.push(`- ${rec}`);
      }
      output.push('');
    }

    output.push(`\n*Generated at ${new Date(report.timestamp).toLocaleString()}*`);

    return output.join('\n');
  }

  /**
   * Show validation UI
   */
  async showValidationUI(report: ValidationReport): Promise<void> {
    const formatted = this.formatReport(report);

    const doc = await vscode.workspace.openTextDocument({
      content: formatted,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Format file size
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  dispose(): void {
    // Cleanup if needed
  }
}

import * as vscode from 'vscode';
import * as path from 'path';

export interface DiagnosticInfo {
  uri: vscode.Uri;
  diagnostics: vscode.Diagnostic[];
  severity: vscode.DiagnosticSeverity;
}

export class DiagnosticsIntegration {
  private cache: Map<string, string> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds

  constructor() {}

  /**
   * Get all diagnostics from the workspace
   */
  public getAllDiagnostics(): DiagnosticInfo[] {
    const diagnostics = vscode.languages.getDiagnostics();
    const result: DiagnosticInfo[] = [];

    for (const [uri, diags] of diagnostics) {
      if (diags.length === 0) {
        continue;
      }

      // Get highest severity
      const severity = this.getHighestSeverity(diags);

      result.push({
        uri,
        diagnostics: diags,
        severity
      });
    }

    return result;
  }

  /**
   * Get diagnostics filtered by severity
   */
  public getDiagnosticsBySeverity(
    severities: vscode.DiagnosticSeverity[]
  ): DiagnosticInfo[] {
    const all = this.getAllDiagnostics();

    return all.filter(info => severities.includes(info.severity));
  }

  /**
   * Get formatted diagnostics context
   */
  public getFormattedDiagnostics(): string {
    const config = vscode.workspace.getConfiguration('copyContext');
    const includeDiagnostics = config.get<boolean>('includeDiagnostics', true);

    if (!includeDiagnostics) {
      return '';
    }

    const severityFilter = config.get<string[]>('diagnosticSeverity', ['error', 'warning']);
    const severities = this.mapSeverityStrings(severityFilter);

    const diagnostics = this.getDiagnosticsBySeverity(severities);

    if (diagnostics.length === 0) {
      return '';
    }

    const cacheKey = 'diagnostics';
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let output = '# Active Diagnostics\n\n';

    // Group by severity
    const grouped = new Map<vscode.DiagnosticSeverity, DiagnosticInfo[]>();
    for (const info of diagnostics) {
      if (!grouped.has(info.severity)) {
        grouped.set(info.severity, []);
      }
      grouped.get(info.severity)!.push(info);
    }

    // Output errors first, then warnings, then info
    const severityOrder = [
      vscode.DiagnosticSeverity.Error,
      vscode.DiagnosticSeverity.Warning,
      vscode.DiagnosticSeverity.Information
    ];

    for (const severity of severityOrder) {
      const items = grouped.get(severity);
      if (!items || items.length === 0) {
        continue;
      }

      output += `## ${this.getSeverityLabel(severity)} (${items.length} files)\n\n`;

      for (const info of items) {
        output += this.formatFileDiagnostics(info);
      }

      output += '\n';
    }

    // Cache the result
    this.cache.set(cacheKey, output);
    setTimeout(() => this.cache.delete(cacheKey), this.CACHE_TTL);

    return output;
  }

  private formatFileDiagnostics(info: DiagnosticInfo): string {
    const fileName = path.basename(info.uri.fsPath);
    const relativePath = vscode.workspace.asRelativePath(info.uri);

    let output = `### ${fileName}\n\n`;
    output += `**File**: \`${relativePath}\`\n\n`;

    // Group diagnostics by line
    const byLine = new Map<number, vscode.Diagnostic[]>();
    for (const diag of info.diagnostics) {
      const line = diag.range.start.line;
      if (!byLine.has(line)) {
        byLine.set(line, []);
      }
      byLine.get(line)!.push(diag);
    }

    // Sort by line number
    const sortedLines = Array.from(byLine.entries()).sort((a, b) => a[0] - b[0]);

    for (const [line, diags] of sortedLines) {
      for (const diag of diags) {
        const lineNum = line + 1; // 1-indexed for display
        const severity = this.getSeverityIcon(diag.severity);

        output += `- ${severity} **Line ${lineNum}**: ${diag.message}\n`;

        if (diag.source) {
          output += `  - Source: ${diag.source}\n`;
        }

        if (diag.code) {
          output += `  - Code: ${diag.code}\n`;
        }

        if (diag.relatedInformation && diag.relatedInformation.length > 0) {
          output += '  - Related:\n';
          for (const related of diag.relatedInformation) {
            const relPath = vscode.workspace.asRelativePath(related.location.uri);
            const relLine = related.location.range.start.line + 1;
            output += `    - ${relPath}:${relLine} - ${related.message}\n`;
          }
        }
      }
    }

    output += '\n';
    return output;
  }

  /**
   * Get files with diagnostics
   */
  public getFilesWithDiagnostics(
    severities?: vscode.DiagnosticSeverity[]
  ): vscode.Uri[] {
    let diagnostics = this.getAllDiagnostics();

    if (severities) {
      diagnostics = diagnostics.filter(info => severities.includes(info.severity));
    }

    return diagnostics.map(info => info.uri);
  }

  /**
   * Get diagnostics count by severity
   */
  public getDiagnosticsCounts(): Record<string, number> {
    const all = this.getAllDiagnostics();

    const counts = {
      error: 0,
      warning: 0,
      information: 0,
      hint: 0,
      total: 0
    };

    for (const info of all) {
      counts.total += info.diagnostics.length;

      for (const diag of info.diagnostics) {
        switch (diag.severity) {
          case vscode.DiagnosticSeverity.Error:
            counts.error++;
            break;
          case vscode.DiagnosticSeverity.Warning:
            counts.warning++;
            break;
          case vscode.DiagnosticSeverity.Information:
            counts.information++;
            break;
          case vscode.DiagnosticSeverity.Hint:
            counts.hint++;
            break;
        }
      }
    }

    return counts;
  }

  /**
   * Format diagnostics summary
   */
  public getSummary(): string {
    const counts = this.getDiagnosticsCounts();

    if (counts.total === 0) {
      return '✓ No active diagnostics';
    }

    const parts: string[] = [];

    if (counts.error > 0) {
      parts.push(`${counts.error} error${counts.error > 1 ? 's' : ''}`);
    }

    if (counts.warning > 0) {
      parts.push(`${counts.warning} warning${counts.warning > 1 ? 's' : ''}`);
    }

    if (counts.information > 0) {
      parts.push(`${counts.information} info`);
    }

    return parts.join(', ');
  }

  private getHighestSeverity(diagnostics: vscode.Diagnostic[]): vscode.DiagnosticSeverity {
    let highest = vscode.DiagnosticSeverity.Hint;

    for (const diag of diagnostics) {
      if (diag.severity < highest) {
        highest = diag.severity;
      }
    }

    return highest;
  }

  private getSeverityLabel(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return '🔴 Errors';
      case vscode.DiagnosticSeverity.Warning:
        return '🟡 Warnings';
      case vscode.DiagnosticSeverity.Information:
        return '🔵 Information';
      case vscode.DiagnosticSeverity.Hint:
        return '💡 Hints';
      default:
        return 'Unknown';
    }
  }

  private getSeverityIcon(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return '🔴';
      case vscode.DiagnosticSeverity.Warning:
        return '🟡';
      case vscode.DiagnosticSeverity.Information:
        return '🔵';
      case vscode.DiagnosticSeverity.Hint:
        return '💡';
      default:
        return '•';
    }
  }

  private mapSeverityStrings(severities: string[]): vscode.DiagnosticSeverity[] {
    const result: vscode.DiagnosticSeverity[] = [];

    for (const severity of severities) {
      switch (severity.toLowerCase()) {
        case 'error':
          result.push(vscode.DiagnosticSeverity.Error);
          break;
        case 'warning':
          result.push(vscode.DiagnosticSeverity.Warning);
          break;
        case 'info':
        case 'information':
          result.push(vscode.DiagnosticSeverity.Information);
          break;
        case 'hint':
          result.push(vscode.DiagnosticSeverity.Hint);
          break;
      }
    }

    return result;
  }

  /**
   * Clear the cache
   */
  public clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.cache.clear();
  }
}

import * as vscode from 'vscode';

export type TemplateType = 'debug' | 'review' | 'feature' | 'custom';

export interface ContextTemplate {
  name: string;
  description: string;
  icon: string;
  includeGitChanges: boolean;
  includeGitDiff: boolean;
  includeRelatedFiles: boolean;
  includeDiagnostics: boolean;
  includeDependencies: boolean;
  includeDocFiles: boolean;
  optimizationMode: 'auto' | 'full' | 'signatures' | 'diffs';
  maxFiles?: number;
  customInstructions?: string;
}

export class ContextTemplateManager {
  private templates: Map<TemplateType, ContextTemplate> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates(): void {
    // Debug template: Focus on errors, diagnostics, and git changes
    this.templates.set('debug', {
      name: 'Debug Context',
      description: 'Optimized for debugging errors and issues',
      icon: '$(bug)',
      includeGitChanges: true,
      includeGitDiff: true,
      includeRelatedFiles: true,
      includeDiagnostics: true,
      includeDependencies: false,
      includeDocFiles: false,
      optimizationMode: 'full',
      maxFiles: 10
    });

    // Review template: Focus on git diffs, tests, and signatures
    this.templates.set('review', {
      name: 'Code Review Context',
      description: 'Optimized for reviewing code changes',
      icon: '$(git-pull-request)',
      includeGitChanges: true,
      includeGitDiff: true,
      includeRelatedFiles: true,
      includeDiagnostics: false,
      includeDependencies: false,
      includeDocFiles: false,
      optimizationMode: 'signatures',
      maxFiles: 20
    });

    // Feature template: Focus on architecture, docs, and similar code
    this.templates.set('feature', {
      name: 'Feature Development Context',
      description: 'Optimized for implementing new features',
      icon: '$(sparkle)',
      includeGitChanges: false,
      includeGitDiff: false,
      includeRelatedFiles: true,
      includeDiagnostics: false,
      includeDependencies: true,
      includeDocFiles: true,
      optimizationMode: 'auto',
      maxFiles: 15
    });
  }

  /**
   * Get a template by type
   */
  getTemplate(type: TemplateType): ContextTemplate | undefined {
    return this.templates.get(type);
  }

  /**
   * Get all available templates
   */
  getAllTemplates(): ContextTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Apply a template to VS Code configuration
   */
  async applyTemplate(type: TemplateType): Promise<void> {
    const template = this.templates.get(type);
    if (!template) {
      vscode.window.showErrorMessage(`Template '${type}' not found`);
      return;
    }

    const config = vscode.workspace.getConfiguration('copyContext');

    await config.update('includeGitInfo', template.includeGitChanges, vscode.ConfigurationTarget.Workspace);
    await config.update('includeDiff', template.includeGitDiff, vscode.ConfigurationTarget.Workspace);
    await config.update('autoIncludeRelated', template.includeRelatedFiles, vscode.ConfigurationTarget.Workspace);
    await config.update('includeDiagnostics', template.includeDiagnostics, vscode.ConfigurationTarget.Workspace);
    await config.update('includeDependencies', template.includeDependencies, vscode.ConfigurationTarget.Workspace);
    await config.update('includeDocFiles', template.includeDocFiles, vscode.ConfigurationTarget.Workspace);
    await config.update('optimizationMode', template.optimizationMode, vscode.ConfigurationTarget.Workspace);

    if (template.maxFiles) {
      await config.update('maxFiles', template.maxFiles, vscode.ConfigurationTarget.Workspace);
    }

    vscode.window.showInformationMessage(`Applied '${template.name}' template`);
  }

  /**
   * Show template picker and apply selected template
   */
  async selectAndApplyTemplate(): Promise<void> {
    const templates = this.getAllTemplates();

    const quickPickItems: vscode.QuickPickItem[] = templates.map(template => ({
      label: `${template.icon} ${template.name}`,
      description: template.description,
      detail: this.getTemplateDetails(template)
    }));

    const selected = await vscode.window.showQuickPick(quickPickItems, {
      placeHolder: 'Select a context template',
      title: 'Context Templates'
    });

    if (selected) {
      const templateName = selected.label.replace(/^\$\([^)]+\)\s+/, '');
      const templateType = templates.find(t => t.name === templateName);

      if (templateType) {
        const type = Array.from(this.templates.entries())
          .find(([_, template]) => template.name === templateName)?.[0];

        if (type) {
          await this.applyTemplate(type);
        }
      }
    }
  }

  private getTemplateDetails(template: ContextTemplate): string {
    const features: string[] = [];

    if (template.includeGitChanges) features.push('Git changes');
    if (template.includeGitDiff) features.push('Diffs');
    if (template.includeRelatedFiles) features.push('Related files');
    if (template.includeDiagnostics) features.push('Errors/Warnings');
    if (template.includeDependencies) features.push('Dependencies');
    if (template.includeDocFiles) features.push('Documentation');

    features.push(`Optimization: ${template.optimizationMode}`);

    if (template.maxFiles) {
      features.push(`Max files: ${template.maxFiles}`);
    }

    return features.join(' • ');
  }

  /**
   * Create a custom template
   */
  async createCustomTemplate(): Promise<void> {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter template name',
      placeHolder: 'My Custom Template'
    });

    if (!name) {
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: 'Enter template description',
      placeHolder: 'Description of what this template is used for'
    });

    // Get current configuration as starting point
    const config = vscode.workspace.getConfiguration('copyContext');

    const customTemplate: ContextTemplate = {
      name,
      description: description || '',
      icon: '$(star)',
      includeGitChanges: config.get<boolean>('includeGitInfo', true),
      includeGitDiff: config.get<boolean>('includeDiff', true),
      includeRelatedFiles: config.get<boolean>('autoIncludeRelated', true),
      includeDiagnostics: config.get<boolean>('includeDiagnostics', true),
      includeDependencies: config.get<boolean>('includeDependencies', true),
      includeDocFiles: config.get<boolean>('includeDocFiles', true),
      optimizationMode: config.get<'auto' | 'full' | 'signatures' | 'diffs'>('optimizationMode', 'auto'),
      maxFiles: config.get<number>('maxFiles', 5)
    };

    this.templates.set('custom', customTemplate);

    vscode.window.showInformationMessage(`Created custom template '${name}'`);
  }

  /**
   * Export template to JSON
   */
  async exportTemplate(type: TemplateType): Promise<void> {
    const template = this.templates.get(type);
    if (!template) {
      return;
    }

    const json = JSON.stringify(template, null, 2);
    const document = await vscode.workspace.openTextDocument({
      content: json,
      language: 'json'
    });

    await vscode.window.showTextDocument(document);
  }

  /**
   * Import template from JSON
   */
  async importTemplate(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('Please open a JSON file with template configuration');
      return;
    }

    try {
      const content = editor.document.getText();
      const template = JSON.parse(content) as ContextTemplate;

      // Validate template structure
      if (!template.name || !template.description) {
        throw new Error('Invalid template format');
      }

      this.templates.set('custom', template);
      vscode.window.showInformationMessage(`Imported template '${template.name}'`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to import template: ${error}`);
    }
  }

  /**
   * Get template configuration for a specific type
   */
  getTemplateConfig(type: TemplateType): Partial<vscode.WorkspaceConfiguration> {
    const template = this.templates.get(type);
    if (!template) {
      return {};
    }

    return {
      get: (key: string) => {
        switch (key) {
          case 'includeGitInfo':
            return template.includeGitChanges;
          case 'includeDiff':
            return template.includeGitDiff;
          case 'autoIncludeRelated':
            return template.includeRelatedFiles;
          case 'includeDiagnostics':
            return template.includeDiagnostics;
          case 'includeDependencies':
            return template.includeDependencies;
          case 'includeDocFiles':
            return template.includeDocFiles;
          case 'optimizationMode':
            return template.optimizationMode;
          case 'maxFiles':
            return template.maxFiles;
          default:
            return undefined;
        }
      }
    } as Partial<vscode.WorkspaceConfiguration>;
  }

  /**
   * Format template information for display
   */
  formatTemplate(type: TemplateType): string {
    const template = this.templates.get(type);
    if (!template) {
      return '';
    }

    let output = `# ${template.icon} ${template.name}\n\n`;
    output += `${template.description}\n\n`;
    output += '## Configuration\n\n';

    const configs = [
      { label: 'Git Changes', value: template.includeGitChanges },
      { label: 'Git Diffs', value: template.includeGitDiff },
      { label: 'Related Files', value: template.includeRelatedFiles },
      { label: 'Diagnostics', value: template.includeDiagnostics },
      { label: 'Dependencies', value: template.includeDependencies },
      { label: 'Documentation', value: template.includeDocFiles },
      { label: 'Optimization Mode', value: template.optimizationMode },
    ];

    for (const config of configs) {
      const value = typeof config.value === 'boolean'
        ? (config.value ? '✓ Enabled' : '✗ Disabled')
        : config.value;
      output += `- **${config.label}**: ${value}\n`;
    }

    if (template.maxFiles) {
      output += `- **Max Files**: ${template.maxFiles}\n`;
    }

    if (template.customInstructions) {
      output += `\n## Custom Instructions\n\n${template.customInstructions}\n`;
    }

    return output;
  }
}

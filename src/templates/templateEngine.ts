import * as vscode from 'vscode';
import { TokenCounter } from '../tokenCounter';

/**
 * Output format types
 */
export type OutputFormat = 'markdown' | 'json' | 'html' | 'plaintext' | 'xml' | 'custom';

/**
 * Template variable with dynamic value
 */
export interface TemplateVariable {
  name: string;
  description: string;
  defaultValue?: string;
  compute?: (context: TemplateContext) => Promise<string | number>;
}

/**
 * Template section
 */
export interface TemplateSection {
  id: string;
  name: string;
  header: string;
  order: number;
  optional: boolean;
  condition?: (context: TemplateContext) => boolean;
  content: (context: TemplateContext) => Promise<string>;
}

/**
 * Template transformation
 */
export interface TemplateTransform {
  name: string;
  description: string;
  apply: (content: string, options?: any) => string;
}

/**
 * Output template definition
 */
export interface OutputTemplate {
  id: string;
  name: string;
  description: string;
  format: OutputFormat;
  icon?: string;

  sections: TemplateSection[];
  variables: TemplateVariable[];
  transforms: TemplateTransform[];

  // Template metadata
  author?: string;
  version?: string;
  tags?: string[];

  // Rendering options
  includeHeader?: boolean;
  includeFooter?: boolean;
  includeMetadata?: boolean;
  includeTableOfContents?: boolean;
}

/**
 * Context passed to template renderer
 */
export interface TemplateContext {
  files: vscode.Uri[];
  gitContext?: string;
  diagnostics?: any;
  variables: Map<string, any>;

  // Computed properties
  totalTokens?: number;
  totalSize?: number;
  fileCount?: number;

  // User inputs
  userInputs?: Map<string, string>;

  // Metadata
  timestamp: Date;
  workspace: string;
  userName?: string;
}

/**
 * Template rendering result
 */
export interface TemplateRenderResult {
  content: string;
  format: OutputFormat;
  metadata: {
    template: string;
    renderedAt: Date;
    fileCount: number;
    totalTokens?: number;
  };
}

/**
 * Template Engine
 * Renders context using customizable templates
 */
export class TemplateEngine {
  private templates: Map<string, OutputTemplate> = new Map();
  private transforms: Map<string, TemplateTransform> = new Map();

  constructor(private tokenCounter: TokenCounter) {
    this.registerDefaultTransforms();
  }

  /**
   * Register a template
   */
  registerTemplate(template: OutputTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Get template by ID
   */
  getTemplate(id: string): OutputTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get all templates
   */
  getAllTemplates(): OutputTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Register a transform
   */
  registerTransform(transform: TemplateTransform): void {
    this.transforms.set(transform.name, transform);
  }

  /**
   * Render template
   */
  async render(templateId: string, context: TemplateContext): Promise<TemplateRenderResult> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Compute variables
    await this.computeVariables(template, context);

    // Build content
    let content = '';

    // Add header
    if (template.includeHeader) {
      content += this.renderHeader(template, context);
    }

    // Add table of contents
    if (template.includeTableOfContents) {
      content += this.renderTableOfContents(template, context);
    }

    // Add sections (create copy to avoid mutating template)
    const sortedSections = [...template.sections].sort((a, b) => a.order - b.order);

    for (const section of sortedSections) {
      // Check condition
      if (section.condition && !section.condition(context)) {
        continue;
      }

      // Render section
      const sectionContent = await section.content(context);

      // Only include section if it has content (even for non-optional sections)
      if (sectionContent && sectionContent.trim()) {
        content += section.header + '\n\n';
        content += sectionContent + '\n\n';
      } else if (!section.optional && (!sectionContent || !sectionContent.trim())) {
        // Warn about non-optional sections with no content
        console.warn(`Non-optional section "${section.id}" returned no content`);
      }
    }

    // Add metadata
    if (template.includeMetadata) {
      content += this.renderMetadata(template, context);
    }

    // Add footer
    if (template.includeFooter) {
      content += this.renderFooter(template, context);
    }

    // Apply transforms (with error handling)
    for (const transform of template.transforms) {
      const transformFn = this.transforms.get(transform.name);
      if (transformFn) {
        try {
          content = transformFn.apply(content);
        } catch (error) {
          console.error(`Transform "${transform.name}" failed:`, error);
          // Continue with other transforms
        }
      }
    }

    return {
      content,
      format: template.format,
      metadata: {
        template: template.id,
        renderedAt: new Date(),
        fileCount: context.files.length,
        totalTokens: context.totalTokens
      }
    };
  }

  /**
   * Compute template variables
   */
  private async computeVariables(
    template: OutputTemplate,
    context: TemplateContext
  ): Promise<void> {
    for (const variable of template.variables) {
      if (variable.compute) {
        const value = await variable.compute(context);
        context.variables.set(variable.name, value);
      } else if (variable.defaultValue) {
        context.variables.set(variable.name, variable.defaultValue);
      }
    }
  }

  /**
   * Render template header
   */
  private renderHeader(template: OutputTemplate, context: TemplateContext): string {
    return `# ${template.name}\n\n`;
  }

  /**
   * Render table of contents
   */
  private renderTableOfContents(
    template: OutputTemplate,
    context: TemplateContext
  ): string {
    let toc = '## Table of Contents\n\n';

    for (const section of template.sections) {
      if (!section.optional || (section.condition && section.condition(context))) {
        const slug = section.name.toLowerCase().replace(/\s+/g, '-');
        toc += `- [${section.name}](#${slug})\n`;
      }
    }

    return toc + '\n';
  }

  /**
   * Render metadata section
   */
  private renderMetadata(template: OutputTemplate, context: TemplateContext): string {
    let meta = '---\n\n## Metadata\n\n';
    meta += `- **Generated**: ${context.timestamp.toLocaleString()}\n`;
    meta += `- **Workspace**: ${context.workspace}\n`;
    meta += `- **Files**: ${context.fileCount}\n`;

    if (context.totalTokens) {
      meta += `- **Tokens**: ${context.totalTokens.toLocaleString()}\n`;
    }

    if (context.userName) {
      meta += `- **Author**: ${context.userName}\n`;
    }

    return meta + '\n';
  }

  /**
   * Render footer
   */
  private renderFooter(template: OutputTemplate, context: TemplateContext): string {
    return `\n---\n\n*Generated by ContextPack-Pro v${template.version || '1.0.0'}*\n`;
  }

  /**
   * Register default transforms
   */
  private registerDefaultTransforms(): void {
    // Remove excessive whitespace
    this.registerTransform({
      name: 'trim-whitespace',
      description: 'Remove excessive whitespace',
      apply: (content) => content.replace(/\n{3,}/g, '\n\n')
    });

    // Add line numbers
    this.registerTransform({
      name: 'line-numbers',
      description: 'Add line numbers',
      apply: (content) => {
        const lines = content.split('\n');
        return lines.map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`).join('\n');
      }
    });

    // Truncate long lines
    this.registerTransform({
      name: 'truncate-lines',
      description: 'Truncate lines longer than 120 characters',
      apply: (content, options = { maxLength: 120 }) => {
        const lines = content.split('\n');
        return lines.map(line => {
          if (line.length > options.maxLength) {
            return line.substring(0, options.maxLength) + '...';
          }
          return line;
        }).join('\n');
      }
    });

    // Code block wrapper
    this.registerTransform({
      name: 'wrap-code-blocks',
      description: 'Wrap content in code blocks',
      apply: (content, options = { language: '' }) => {
        return `\`\`\`${options.language}\n${content}\n\`\`\``;
      }
    });
  }

  /**
   * Show template selector UI
   */
  async showTemplateSelectorUI(): Promise<OutputTemplate | undefined> {
    const templates = this.getAllTemplates();

    if (templates.length === 0) {
      vscode.window.showInformationMessage('No templates available');
      return undefined;
    }

    const items = templates.map(template => ({
      label: `${template.icon || '$(file)'} ${template.name}`,
      description: template.format,
      detail: template.description,
      template
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select output template',
      matchOnDescription: true,
      matchOnDetail: true
    });

    return selected?.template;
  }

  /**
   * Collect user inputs for template variables
   */
  async collectUserInputs(template: OutputTemplate): Promise<Map<string, string>> {
    const inputs = new Map<string, string>();

    for (const variable of template.variables) {
      if (!variable.compute) {
        const value = await vscode.window.showInputBox({
          prompt: `Enter ${variable.description}`,
          value: variable.defaultValue,
          placeHolder: variable.name
        });

        if (value !== undefined) {
          inputs.set(variable.name, value);
        }
      }
    }

    return inputs;
  }

  dispose(): void {
    this.templates.clear();
    this.transforms.clear();
  }
}

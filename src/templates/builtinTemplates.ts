import * as vscode from 'vscode';
import { OutputTemplate, TemplateContext, TemplateEngine } from './templateEngine';
import * as path from 'path';

/**
 * Built-in templates for common workflows
 */
export class BuiltinTemplates {
  /**
   * Helper to read and format file contents for templates
   */
  private static async getFileContents(uri: vscode.Uri): Promise<string> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const relativePath = vscode.workspace.asRelativePath(uri);
      const content = document.getText();
      const languageId = document.languageId;

      return `### ${relativePath}\n\n\`\`\`${languageId}\n${content}\n\`\`\`\n\n`;
    } catch (error) {
      console.error(`Error reading file ${uri.fsPath}:`, error);
      return `### ${vscode.workspace.asRelativePath(uri)}\n\n*Error reading file*\n\n`;
    }
  }

  /**
   * Helper to get all file contents from context
   */
  private static async getAllFileContents(context: TemplateContext): Promise<string> {
    let allContents = '';
    for (const uri of context.files) {
      allContents += await this.getFileContents(uri);
    }
    return allContents;
  }

  /**
   * Get all built-in templates
   */
  static getAll(): OutputTemplate[] {
    return [
      this.getPRDescriptionTemplate(),
      this.getBugReportTemplate(),
      this.getCodeReviewTemplate(),
      this.getDocumentationTemplate(),
      this.getCommitMessageTemplate(),
      this.getMeetingNotesTemplate(),
      this.getArchitectureDocTemplate(),
      this.getAPIDocTemplate(),
    ];
  }

  /**
   * PR Description Template (GitHub/GitLab)
   */
  private static getPRDescriptionTemplate(): OutputTemplate {
    return {
      id: 'pr-description',
      name: 'PR Description',
      description: 'Generate GitHub/GitLab pull request description',
      format: 'markdown',
      icon: 'git-pull-request',
      includeHeader: true,
      includeMetadata: false,

      variables: [
        {
          name: 'pr_title',
          description: 'PR Title',
          defaultValue: 'feat: Add new feature'
        },
        {
          name: 'ticket_number',
          description: 'Ticket/Issue Number (optional)',
          defaultValue: ''
        },
        {
          name: 'breaking_changes',
          description: 'Breaking Changes',
          compute: async (context) => 'No'
        }
      ],

      sections: [
        {
          id: 'summary',
          name: 'Summary',
          header: '## Summary',
          order: 1,
          optional: false,
          content: async (context) => {
            const title = context.variables.get('pr_title') || 'Changes';
            const ticket = context.variables.get('ticket_number');

            let summary = `This PR ${title.toLowerCase()}.\n\n`;

            if (ticket) {
              summary += `**Related Issue**: #${ticket}\n\n`;
            }

            summary += `**Files Changed**: ${context.fileCount}\n`;
            summary += `**Lines of Code**: ~${context.totalTokens} tokens\n`;

            return summary;
          }
        },
        {
          id: 'changes',
          name: 'Changes',
          header: '## Changes',
          order: 2,
          optional: false,
          content: async (context) => {
            let changes = '';

            const filesByDir = new Map<string, vscode.Uri[]>();

            for (const uri of context.files) {
              const dir = path.dirname(vscode.workspace.asRelativePath(uri));
              if (!filesByDir.has(dir)) {
                filesByDir.set(dir, []);
              }
              filesByDir.get(dir)!.push(uri);
            }

            for (const [dir, files] of filesByDir.entries()) {
              changes += `### \`${dir}\`\n\n`;
              for (const uri of files) {
                const basename = path.basename(uri.fsPath);
                changes += `- Modified \`${basename}\`\n`;
              }
              changes += '\n';
            }

            return changes;
          }
        },
        {
          id: 'testing',
          name: 'Testing',
          header: '## Testing',
          order: 3,
          optional: false,
          content: async (context) => {
            return [
              '- [ ] Unit tests pass',
              '- [ ] Integration tests pass',
              '- [ ] Manual testing completed',
              '- [ ] No breaking changes (or documented)',
              '- [ ] Documentation updated'
            ].join('\n');
          }
        },
        {
          id: 'screenshots',
          name: 'Screenshots',
          header: '## Screenshots (if applicable)',
          order: 4,
          optional: true,
          content: async (context) => {
            return '<!-- Add screenshots here if UI changes -->\n';
          }
        },
        {
          id: 'breaking',
          name: 'Breaking Changes',
          header: '## Breaking Changes',
          order: 5,
          optional: true,
          condition: (context) => context.variables.get('breaking_changes') === 'Yes',
          content: async (context) => {
            return '<!-- Describe breaking changes and migration guide -->\n';
          }
        },
        {
          id: 'code',
          name: 'Code Changes',
          header: '## Code Changes',
          order: 6,
          optional: false,
          content: async (context) => {
            return await BuiltinTemplates.getAllFileContents(context);
          }
        },
        {
          id: 'checklist',
          name: 'Checklist',
          header: '## Checklist',
          order: 7,
          optional: false,
          content: async (context) => {
            return [
              '- [ ] Code follows project style guidelines',
              '- [ ] Self-review completed',
              '- [ ] Comments added for complex code',
              '- [ ] Documentation updated',
              '- [ ] No new warnings generated',
              '- [ ] Tests added/updated',
              '- [ ] All tests passing'
            ].join('\n');
          }
        }
      ],

      transforms: [
        { name: 'trim-whitespace', description: 'Clean whitespace', apply: (c) => c }
      ]
    };
  }

  /**
   * Bug Report Template
   */
  private static getBugReportTemplate(): OutputTemplate {
    return {
      id: 'bug-report',
      name: 'Bug Report',
      description: 'Generate detailed bug report',
      format: 'markdown',
      icon: 'bug',
      includeHeader: true,
      includeMetadata: true,

      variables: [
        {
          name: 'bug_title',
          description: 'Bug Title',
          defaultValue: 'Bug: '
        },
        {
          name: 'severity',
          description: 'Severity (Critical/High/Medium/Low)',
          defaultValue: 'Medium'
        },
        {
          name: 'steps_to_reproduce',
          description: 'Steps to Reproduce',
          defaultValue: '1. \n2. \n3. '
        }
      ],

      sections: [
        {
          id: 'description',
          name: 'Description',
          header: '## Description',
          order: 1,
          optional: false,
          content: async (context) => {
            const severity = context.variables.get('severity');
            return `**Severity**: ${severity}\n\n<!-- Describe the bug clearly -->\n`;
          }
        },
        {
          id: 'reproduce',
          name: 'Steps to Reproduce',
          header: '## Steps to Reproduce',
          order: 2,
          optional: false,
          content: async (context) => {
            const steps = context.variables.get('steps_to_reproduce') || '1. ';
            return steps;
          }
        },
        {
          id: 'expected',
          name: 'Expected Behavior',
          header: '## Expected Behavior',
          order: 3,
          optional: false,
          content: async () => '<!-- What should happen -->\n'
        },
        {
          id: 'actual',
          name: 'Actual Behavior',
          header: '## Actual Behavior',
          order: 4,
          optional: false,
          content: async () => '<!-- What actually happens -->\n'
        },
        {
          id: 'context',
          name: 'Code Context',
          header: '## Code Context',
          order: 5,
          optional: false,
          content: async (context) => {
            let code = `**Files Involved** (${context.fileCount}):\n\n`;
            code += await BuiltinTemplates.getAllFileContents(context);
            return code;
          }
        },
        {
          id: 'environment',
          name: 'Environment',
          header: '## Environment',
          order: 6,
          optional: false,
          content: async () => {
            return [
              `- **OS**: ${process.platform}`,
              `- **VS Code**: ${vscode.version}`,
              `- **Node**: ${process.version}`,
              '- **Browser**: <!-- If applicable -->',
              '- **Extension Version**: 1.0.0'
            ].join('\n');
          }
        }
      ],

      transforms: [
        { name: 'trim-whitespace', description: 'Clean whitespace', apply: (c) => c }
      ]
    };
  }

  /**
   * Code Review Template
   */
  private static getCodeReviewTemplate(): OutputTemplate {
    return {
      id: 'code-review',
      name: 'Code Review',
      description: 'Structured code review comments',
      format: 'markdown',
      icon: 'eye',
      includeHeader: true,
      includeTableOfContents: true,

      variables: [],

      sections: [
        {
          id: 'summary',
          name: 'Review Summary',
          header: '## Review Summary',
          order: 1,
          optional: false,
          content: async (context) => {
            return `Reviewed ${context.fileCount} files.\n\n**Overall Assessment**: <!-- Approve / Request Changes / Comment -->\n`;
          }
        },
        {
          id: 'strengths',
          name: 'Strengths',
          header: '## Strengths',
          order: 2,
          optional: false,
          content: async () => '- <!-- List positive aspects -->\n'
        },
        {
          id: 'concerns',
          name: 'Concerns',
          header: '## Concerns',
          order: 3,
          optional: false,
          content: async () => '- <!-- List issues or questions -->\n'
        },
        {
          id: 'suggestions',
          name: 'Suggestions',
          header: '## Suggestions',
          order: 4,
          optional: false,
          content: async () => '- <!-- Improvement suggestions -->\n'
        },
        {
          id: 'files',
          name: 'File-by-File Comments',
          header: '## File-by-File Comments',
          order: 5,
          optional: false,
          content: async (context) => {
            return await BuiltinTemplates.getAllFileContents(context);
          }
        }
      ],

      transforms: []
    };
  }

  /**
   * Documentation Template
   */
  private static getDocumentationTemplate(): OutputTemplate {
    return {
      id: 'documentation',
      name: 'Documentation',
      description: 'Generate comprehensive documentation',
      format: 'markdown',
      icon: 'book',
      includeHeader: true,
      includeTableOfContents: true,

      variables: [
        {
          name: 'module_name',
          description: 'Module/Component Name',
          defaultValue: ''
        }
      ],

      sections: [
        {
          id: 'overview',
          name: 'Overview',
          header: '## Overview',
          order: 1,
          optional: false,
          content: async (context) => {
            const moduleName = context.variables.get('module_name');
            return `This module ${moduleName ? `(\`${moduleName}\`)` : ''} contains ${context.fileCount} files.\n`;
          }
        },
        {
          id: 'architecture',
          name: 'Architecture',
          header: '## Architecture',
          order: 2,
          optional: false,
          content: async () => '<!-- Describe the architecture -->\n'
        },
        {
          id: 'api',
          name: 'API Reference',
          header: '## API Reference',
          order: 3,
          optional: false,
          content: async () => '<!-- Document public APIs -->\n'
        },
        {
          id: 'code',
          name: 'Code',
          header: '## Code',
          order: 4,
          optional: false,
          content: async (context) => {
            return await BuiltinTemplates.getAllFileContents(context);
          }
        },
        {
          id: 'usage',
          name: 'Usage Examples',
          header: '## Usage Examples',
          order: 5,
          optional: false,
          content: async () => '```typescript\n// Example usage\n```\n'
        }
      ],

      transforms: []
    };
  }

  /**
   * Commit Message Template
   */
  private static getCommitMessageTemplate(): OutputTemplate {
    return {
      id: 'commit-message',
      name: 'Commit Message',
      description: 'Generate conventional commit message',
      format: 'plaintext',
      icon: 'git-commit',
      includeHeader: false,

      variables: [
        {
          name: 'type',
          description: 'Commit type (feat/fix/docs/refactor/test/chore)',
          defaultValue: 'feat'
        },
        {
          name: 'scope',
          description: 'Scope (optional)',
          defaultValue: ''
        },
        {
          name: 'subject',
          description: 'Short description',
          defaultValue: ''
        },
        {
          name: 'body',
          description: 'Detailed description (optional)',
          defaultValue: ''
        }
      ],

      sections: [
        {
          id: 'header',
          name: 'Header',
          header: '',
          order: 1,
          optional: false,
          content: async (context) => {
            const type = context.variables.get('type');
            const scope = context.variables.get('scope');
            const subject = context.variables.get('subject');

            let header = type;
            if (scope) {
              header += `(${scope})`;
            }
            header += `: ${subject}`;

            return header;
          }
        },
        {
          id: 'body',
          name: 'Body',
          header: '',
          order: 2,
          optional: true,
          condition: (context) => !!context.variables.get('body'),
          content: async (context) => {
            return '\n' + context.variables.get('body');
          }
        },
        {
          id: 'files',
          name: 'Files',
          header: '',
          order: 3,
          optional: false,
          content: async (context) => {
            let files = '\n\nFiles modified:\n';

            for (const uri of context.files) {
              const relativePath = vscode.workspace.asRelativePath(uri);
              files += `- ${relativePath}\n`;
            }

            return files;
          }
        }
      ],

      transforms: []
    };
  }

  /**
   * Meeting Notes Template
   */
  private static getMeetingNotesTemplate(): OutputTemplate {
    return {
      id: 'meeting-notes',
      name: 'Meeting Notes',
      description: 'Code discussion meeting notes',
      format: 'markdown',
      icon: 'comment-discussion',
      includeHeader: true,
      includeMetadata: true,

      variables: [
        {
          name: 'meeting_topic',
          description: 'Meeting Topic',
          defaultValue: 'Code Review Session'
        }
      ],

      sections: [
        {
          id: 'attendees',
          name: 'Attendees',
          header: '## Attendees',
          order: 1,
          optional: false,
          content: async () => '- <!-- List attendees -->\n'
        },
        {
          id: 'context',
          name: 'Code Context',
          header: '## Code Context',
          order: 2,
          optional: false,
          content: async (context) => {
            let code = `Discussed ${context.fileCount} files:\n\n`;

            for (const uri of context.files) {
              const relativePath = vscode.workspace.asRelativePath(uri);
              code += `- \`${relativePath}\`\n`;
            }

            return code;
          }
        },
        {
          id: 'discussion',
          name: 'Discussion Points',
          header: '## Discussion Points',
          order: 3,
          optional: false,
          content: async () => '- <!-- Key discussion points -->\n'
        },
        {
          id: 'decisions',
          name: 'Decisions Made',
          header: '## Decisions Made',
          order: 4,
          optional: false,
          content: async () => '- <!-- List decisions -->\n'
        },
        {
          id: 'actions',
          name: 'Action Items',
          header: '## Action Items',
          order: 5,
          optional: false,
          content: async () => '- [ ] <!-- Action item -->\n'
        }
      ],

      transforms: []
    };
  }

  /**
   * Architecture Documentation Template
   */
  private static getArchitectureDocTemplate(): OutputTemplate {
    return {
      id: 'architecture-doc',
      name: 'Architecture Doc',
      description: 'System architecture documentation',
      format: 'markdown',
      icon: 'organization',
      includeHeader: true,
      includeTableOfContents: true,

      variables: [],

      sections: [
        {
          id: 'system-overview',
          name: 'System Overview',
          header: '## System Overview',
          order: 1,
          optional: false,
          content: async () => '<!-- High-level system description -->\n'
        },
        {
          id: 'components',
          name: 'Components',
          header: '## Components',
          order: 2,
          optional: false,
          content: async (context) => {
            let components = '';

            const filesByDir = new Map<string, vscode.Uri[]>();

            for (const uri of context.files) {
              const dir = path.dirname(vscode.workspace.asRelativePath(uri));
              if (!filesByDir.has(dir)) {
                filesByDir.set(dir, []);
              }
              filesByDir.get(dir)!.push(uri);
            }

            for (const [dir, files] of filesByDir.entries()) {
              components += `### ${dir}\n\n`;
              components += `Contains ${files.length} files\n\n`;
              components += '<!-- Component description -->\n\n';
            }

            return components;
          }
        },
        {
          id: 'dependencies',
          name: 'Dependencies',
          header: '## Dependencies',
          order: 3,
          optional: false,
          content: async () => '<!-- Internal and external dependencies -->\n'
        },
        {
          id: 'data-flow',
          name: 'Data Flow',
          header: '## Data Flow',
          order: 4,
          optional: false,
          content: async () => '<!-- How data flows through the system -->\n'
        }
      ],

      transforms: []
    };
  }

  /**
   * API Documentation Template
   */
  private static getAPIDocTemplate(): OutputTemplate {
    return {
      id: 'api-doc',
      name: 'API Documentation',
      description: 'REST API documentation',
      format: 'markdown',
      icon: 'server',
      includeHeader: true,
      includeTableOfContents: true,

      variables: [],

      sections: [
        {
          id: 'endpoints',
          name: 'Endpoints',
          header: '## Endpoints',
          order: 1,
          optional: false,
          content: async (context) => {
            let endpoints = '';

            for (const uri of context.files) {
              const basename = path.basename(uri.fsPath, path.extname(uri.fsPath));
              endpoints += `### ${basename}\n\n`;
              endpoints += '**Method**: <!-- GET/POST/PUT/DELETE -->\n\n';
              endpoints += '**Path**: \`/api/...\`\n\n';
              endpoints += '**Description**: <!-- Endpoint description -->\n\n';
              endpoints += '**Request**:\n```json\n{\n  // Request body\n}\n```\n\n';
              endpoints += '**Response**:\n```json\n{\n  // Response body\n}\n```\n\n';
            }

            return endpoints;
          }
        },
        {
          id: 'authentication',
          name: 'Authentication',
          header: '## Authentication',
          order: 2,
          optional: false,
          content: async () => '<!-- Authentication requirements -->\n'
        },
        {
          id: 'errors',
          name: 'Error Codes',
          header: '## Error Codes',
          order: 3,
          optional: false,
          content: async () => '| Code | Description |\n|------|-------------|\n| 400  | Bad Request |\n| 401  | Unauthorized |\n| 404  | Not Found |\n| 500  | Server Error |\n'
        }
      ],

      transforms: []
    };
  }

  /**
   * Register all built-in templates with the template engine
   */
  static registerAll(engine: TemplateEngine): void {
    engine.registerTemplate(this.getPRDescriptionTemplate());
    engine.registerTemplate(this.getBugReportTemplate());
    engine.registerTemplate(this.getCodeReviewTemplate());
    engine.registerTemplate(this.getDocumentationTemplate());
    engine.registerTemplate(this.getCommitMessageTemplate());
    engine.registerTemplate(this.getMeetingNotesTemplate());
    engine.registerTemplate(this.getArchitectureDocTemplate());
    engine.registerTemplate(this.getAPIDocTemplate());
  }
}

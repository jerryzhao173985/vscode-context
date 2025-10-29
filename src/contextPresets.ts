import * as vscode from 'vscode';
import * as path from 'path';

export interface ContextPreset {
  id: string;
  name: string;
  description?: string;
  files: string[]; // file paths
  mode?: 'git-changes' | 'current-task' | 'error-focus' | 'full-project';
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: {
    totalTokens?: number;
    fileCount?: number;
    taskType?: 'debug' | 'review' | 'feature' | 'refactor' | 'documentation';
    [key: string]: any;
  };
}

export interface PresetTemplate {
  name: string;
  description: string;
  taskType: 'debug' | 'review' | 'feature' | 'refactor' | 'documentation';
  autoInclude: {
    gitChanges?: boolean;
    openEditors?: boolean;
    errorFiles?: boolean;
    relatedFiles?: boolean;
    documentation?: boolean;
  };
}

export class ContextPresetsManager {
  private presets: Map<string, ContextPreset> = new Map();
  private currentPreset: string | undefined;
  private readonly STORAGE_KEY = 'contextPack.presets';
  private readonly CURRENT_PRESET_KEY = 'contextPack.currentPreset';

  constructor(private context: vscode.ExtensionContext) {
    this.loadPresets();
  }

  /**
   * Load presets from storage
   */
  private loadPresets(): void {
    const stored = this.context.globalState.get<ContextPreset[]>(this.STORAGE_KEY, []);
    this.presets.clear();

    for (const preset of stored) {
      this.presets.set(preset.id, preset);
    }

    this.currentPreset = this.context.globalState.get<string>(this.CURRENT_PRESET_KEY);
  }

  /**
   * Save presets to storage
   */
  private async savePresets(): Promise<void> {
    const presetsArray = Array.from(this.presets.values());
    await this.context.globalState.update(this.STORAGE_KEY, presetsArray);

    if (this.currentPreset) {
      await this.context.globalState.update(this.CURRENT_PRESET_KEY, this.currentPreset);
    }
  }

  /**
   * Create a new preset
   */
  async createPreset(
    name: string,
    files: vscode.Uri[],
    options?: {
      description?: string;
      mode?: ContextPreset['mode'];
      tags?: string[];
      metadata?: ContextPreset['metadata'];
    }
  ): Promise<ContextPreset> {
    const id = this.generateId();
    const filePaths = files.map(uri => uri.fsPath);

    const preset: ContextPreset = {
      id,
      name,
      description: options?.description,
      files: filePaths,
      mode: options?.mode,
      tags: options?.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        fileCount: files.length,
        ...options?.metadata
      }
    };

    this.presets.set(id, preset);
    await this.savePresets();

    return preset;
  }

  /**
   * Update an existing preset
   */
  async updatePreset(
    id: string,
    updates: Partial<Omit<ContextPreset, 'id' | 'createdAt'>>
  ): Promise<ContextPreset | undefined> {
    const preset = this.presets.get(id);
    if (!preset) {
      return undefined;
    }

    const updated: ContextPreset = {
      ...preset,
      ...updates,
      updatedAt: Date.now()
    };

    this.presets.set(id, updated);
    await this.savePresets();

    return updated;
  }

  /**
   * Delete a preset
   */
  async deletePreset(id: string): Promise<boolean> {
    const deleted = this.presets.delete(id);

    if (deleted) {
      if (this.currentPreset === id) {
        this.currentPreset = undefined;
      }
      await this.savePresets();
    }

    return deleted;
  }

  /**
   * Get a preset by ID
   */
  getPreset(id: string): ContextPreset | undefined {
    return this.presets.get(id);
  }

  /**
   * Get all presets
   */
  getAllPresets(): ContextPreset[] {
    return Array.from(this.presets.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Get presets by tag
   */
  getPresetsByTag(tag: string): ContextPreset[] {
    return this.getAllPresets().filter(preset => preset.tags?.includes(tag));
  }

  /**
   * Get presets by task type
   */
  getPresetsByTaskType(taskType: string): ContextPreset[] {
    return this.getAllPresets().filter(preset => preset.metadata?.taskType === taskType);
  }

  /**
   * Set current active preset
   */
  async setCurrentPreset(id: string): Promise<void> {
    if (this.presets.has(id)) {
      this.currentPreset = id;
      await this.context.globalState.update(this.CURRENT_PRESET_KEY, id);
    }
  }

  /**
   * Get current active preset
   */
  getCurrentPreset(): ContextPreset | undefined {
    return this.currentPreset ? this.presets.get(this.currentPreset) : undefined;
  }

  /**
   * Clear current preset
   */
  async clearCurrentPreset(): Promise<void> {
    this.currentPreset = undefined;
    await this.context.globalState.update(this.CURRENT_PRESET_KEY, undefined);
  }

  /**
   * Apply preset to get file URIs
   */
  applyPreset(preset: ContextPreset): vscode.Uri[] {
    return preset.files
      .map(filePath => {
        try {
          return vscode.Uri.file(filePath);
        } catch {
          return null;
        }
      })
      .filter((uri): uri is vscode.Uri => uri !== null);
  }

  /**
   * Quick save current selection as preset
   */
  async quickSave(name: string, files: vscode.Uri[]): Promise<ContextPreset> {
    // Check if preset with same name exists
    const existing = this.getAllPresets().find(p => p.name === name);

    if (existing) {
      // Update existing preset
      return (await this.updatePreset(existing.id, {
        files: files.map(uri => uri.fsPath),
        metadata: {
          ...existing.metadata,
          fileCount: files.length
        }
      }))!;
    } else {
      // Create new preset
      return await this.createPreset(name, files);
    }
  }

  /**
   * Show preset selector UI
   */
  async showPresetSelector(): Promise<ContextPreset | undefined> {
    const presets = this.getAllPresets();

    if (presets.length === 0) {
      vscode.window.showInformationMessage('No presets saved yet');
      return undefined;
    }

    const items = presets.map(preset => ({
      label: `$(bookmark) ${preset.name}`,
      description: this.formatPresetDescription(preset),
      detail: preset.description || `${preset.files.length} files • ${this.formatDate(preset.updatedAt)}`,
      preset
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a context preset',
      matchOnDescription: true,
      matchOnDetail: true
    });

    return selected?.preset;
  }

  /**
   * Show create preset UI
   */
  async showCreatePresetUI(files: vscode.Uri[]): Promise<ContextPreset | undefined> {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter preset name',
      placeHolder: 'e.g., "Authentication Bug Fix", "User Profile Feature"',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Preset name is required';
        }
        return null;
      }
    });

    if (!name) {
      return undefined;
    }

    const description = await vscode.window.showInputBox({
      prompt: 'Enter description (optional)',
      placeHolder: 'Brief description of this context...'
    });

    // Ask for task type
    const taskTypeItems = [
      { label: '$(bug) Debug', description: 'Debugging and bug fixing', value: 'debug' as const },
      { label: '$(git-pull-request) Review', description: 'Code review', value: 'review' as const },
      { label: '$(sparkle) Feature', description: 'New feature development', value: 'feature' as const },
      { label: '$(gear) Refactor', description: 'Code refactoring', value: 'refactor' as const },
      { label: '$(book) Documentation', description: 'Documentation work', value: 'documentation' as const }
    ];

    const taskType = await vscode.window.showQuickPick(taskTypeItems, {
      placeHolder: 'Select task type (optional)'
    });

    // Ask for tags
    const tagsInput = await vscode.window.showInputBox({
      prompt: 'Enter tags (comma-separated, optional)',
      placeHolder: 'e.g., backend, authentication, urgent'
    });

    const tags = tagsInput
      ? tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : [];

    return await this.createPreset(name, files, {
      description: description || undefined,
      tags,
      metadata: {
        taskType: taskType?.value
      }
    });
  }

  /**
   * Show preset management UI
   */
  async showManagementUI(): Promise<void> {
    const presets = this.getAllPresets();

    if (presets.length === 0) {
      vscode.window.showInformationMessage('No presets to manage');
      return;
    }

    const items = presets.map(preset => ({
      label: `$(bookmark) ${preset.name}`,
      description: this.formatPresetDescription(preset),
      detail: preset.description || `${preset.files.length} files`,
      buttons: [
        {
          iconPath: new vscode.ThemeIcon('edit'),
          tooltip: 'Edit preset'
        },
        {
          iconPath: new vscode.ThemeIcon('trash'),
          tooltip: 'Delete preset'
        }
      ],
      preset
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a preset to manage'
    });

    if (selected) {
      const action = await vscode.window.showQuickPick([
        { label: '$(pencil) Rename', action: 'rename' as const },
        { label: '$(note) Edit Description', action: 'description' as const },
        { label: '$(tag) Edit Tags', action: 'tags' as const },
        { label: '$(trash) Delete', action: 'delete' as const }
      ], {
        placeHolder: `Manage "${selected.preset.name}"`
      });

      if (action) {
        await this.handleManagementAction(selected.preset, action.action);
      }
    }
  }

  /**
   * Handle management actions
   */
  private async handleManagementAction(
    preset: ContextPreset,
    action: 'rename' | 'description' | 'tags' | 'delete'
  ): Promise<void> {
    switch (action) {
      case 'rename': {
        const newName = await vscode.window.showInputBox({
          prompt: 'Enter new name',
          value: preset.name,
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'Name is required';
            }
            return null;
          }
        });

        if (newName) {
          await this.updatePreset(preset.id, { name: newName });
          vscode.window.showInformationMessage('Preset renamed');
        }
        break;
      }

      case 'description': {
        const newDescription = await vscode.window.showInputBox({
          prompt: 'Enter new description',
          value: preset.description || '',
          placeHolder: 'Brief description...'
        });

        if (newDescription !== undefined) {
          await this.updatePreset(preset.id, { description: newDescription });
          vscode.window.showInformationMessage('Description updated');
        }
        break;
      }

      case 'tags': {
        const currentTags = preset.tags?.join(', ') || '';
        const newTags = await vscode.window.showInputBox({
          prompt: 'Enter tags (comma-separated)',
          value: currentTags,
          placeHolder: 'e.g., backend, authentication, urgent'
        });

        if (newTags !== undefined) {
          const tags = newTags.split(',').map(t => t.trim()).filter(t => t.length > 0);
          await this.updatePreset(preset.id, { tags });
          vscode.window.showInformationMessage('Tags updated');
        }
        break;
      }

      case 'delete': {
        const confirm = await vscode.window.showWarningMessage(
          `Delete preset "${preset.name}"?`,
          { modal: true },
          'Delete'
        );

        if (confirm === 'Delete') {
          await this.deletePreset(preset.id);
          vscode.window.showInformationMessage('Preset deleted');
        }
        break;
      }
    }
  }

  /**
   * Get preset templates
   */
  getTemplates(): PresetTemplate[] {
    return [
      {
        name: 'Debug Session',
        description: 'Files for debugging - git changes, errors, and related code',
        taskType: 'debug',
        autoInclude: {
          gitChanges: true,
          errorFiles: true,
          relatedFiles: true
        }
      },
      {
        name: 'Code Review',
        description: 'Files for code review - git changes, tests, and documentation',
        taskType: 'review',
        autoInclude: {
          gitChanges: true,
          relatedFiles: true,
          documentation: true
        }
      },
      {
        name: 'Feature Development',
        description: 'Files for new feature - open editors, related files, and docs',
        taskType: 'feature',
        autoInclude: {
          openEditors: true,
          relatedFiles: true,
          documentation: true
        }
      },
      {
        name: 'Refactoring',
        description: 'Files for refactoring - related files and tests',
        taskType: 'refactor',
        autoInclude: {
          openEditors: true,
          relatedFiles: true
        }
      },
      {
        name: 'Documentation',
        description: 'Files for documentation work - docs and related code',
        taskType: 'documentation',
        autoInclude: {
          openEditors: true,
          documentation: true
        }
      }
    ];
  }

  /**
   * Create preset from template
   */
  async createFromTemplate(template: PresetTemplate, context: {
    gitChanges?: vscode.Uri[];
    openEditors?: vscode.Uri[];
    errorFiles?: vscode.Uri[];
    relatedFiles?: vscode.Uri[];
    documentation?: vscode.Uri[];
  }): Promise<vscode.Uri[]> {
    const files = new Set<string>();

    if (template.autoInclude.gitChanges && context.gitChanges) {
      context.gitChanges.forEach(uri => files.add(uri.fsPath));
    }

    if (template.autoInclude.openEditors && context.openEditors) {
      context.openEditors.forEach(uri => files.add(uri.fsPath));
    }

    if (template.autoInclude.errorFiles && context.errorFiles) {
      context.errorFiles.forEach(uri => files.add(uri.fsPath));
    }

    if (template.autoInclude.relatedFiles && context.relatedFiles) {
      context.relatedFiles.forEach(uri => files.add(uri.fsPath));
    }

    if (template.autoInclude.documentation && context.documentation) {
      context.documentation.forEach(uri => files.add(uri.fsPath));
    }

    return Array.from(files).map(fsPath => vscode.Uri.file(fsPath));
  }

  /**
   * Format preset description for display
   */
  private formatPresetDescription(preset: ContextPreset): string {
    const parts: string[] = [];

    if (preset.metadata?.taskType) {
      parts.push(preset.metadata.taskType);
    }

    if (preset.tags && preset.tags.length > 0) {
      parts.push(preset.tags.join(', '));
    }

    return parts.join(' • ');
  }

  /**
   * Format date for display
   */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = Date.now();
    const diff = now - timestamp;

    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }

    // Less than 1 day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }

    // Less than 1 week
    if (diff < 604800000) {
      const days = Math.floor(diff / 86400000);
      return `${days}d ago`;
    }

    // Format as date
    return date.toLocaleDateString();
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `preset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Export presets to JSON
   */
  async exportPresets(): Promise<string> {
    const presets = this.getAllPresets();
    return JSON.stringify(presets, null, 2);
  }

  /**
   * Import presets from JSON
   */
  async importPresets(json: string): Promise<number> {
    try {
      const imported = JSON.parse(json) as ContextPreset[];
      let count = 0;

      for (const preset of imported) {
        // Generate new ID to avoid conflicts
        const newPreset: ContextPreset = {
          ...preset,
          id: this.generateId(),
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        this.presets.set(newPreset.id, newPreset);
        count++;
      }

      await this.savePresets();
      return count;
    } catch (error) {
      throw new Error('Invalid preset data');
    }
  }

  dispose(): void {
    this.presets.clear();
  }
}

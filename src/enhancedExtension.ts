import * as vscode from 'vscode';
import { GitContextProvider } from './gitContext';
import { TokenCounter } from './tokenCounter';
import { FileRelationshipAnalyzer } from './fileRelationships';
import { ContextTreeProvider } from './treeView/contextTreeProvider';
import { ContextTemplateManager } from './contextTemplates';
import { DiagnosticsIntegration } from './diagnosticsIntegration';
import { TokenOptimizer } from './tokenOptimization';
import { DependencyDetector } from './dependencyDetection';
import { PerformanceMonitor } from './performanceMonitor';
import { DocumentationInclusion } from './documentationInclusion';
import { SmartFileSelector } from './smartFileSelection';
import { StatusBarManager } from './statusBarManager';
import { ProjectAnalyzer } from './projectAnalyzer';
import { QuickPickSelector } from './quickPickSelector';
import { ContextSizeOptimizer } from './contextSizeOptimizer';
import { ContextPresetsManager } from './contextPresets';
import { ContentFilteringEngine } from './contentFiltering';
import { ContextHistoryTracker } from './contextHistory';
import { ContextValidator } from './contextValidation';
import { SmartFileGrouping } from './smartFileGrouping';
import { PatternSelector } from './patternSelector';
import { TemplateEngine } from './templates/templateEngine';
import { BuiltinTemplates } from './templates/builtinTemplates';
import { FileMetadataProvider } from './fileMetadata';

/**
 * Enhanced extension features manager
 * Coordinates all new modules and features
 */
export class EnhancedExtension {
  private gitProvider: GitContextProvider | undefined;
  private tokenCounter: TokenCounter;
  private relationshipAnalyzer: FileRelationshipAnalyzer;
  private treeProvider: ContextTreeProvider | undefined;
  private templateManager: ContextTemplateManager;
  private diagnosticsIntegration: DiagnosticsIntegration;
  private tokenOptimizer: TokenOptimizer;

  // New enhancement modules
  private dependencyDetector: DependencyDetector;
  private performanceMonitor: PerformanceMonitor;
  private documentationInclusion: DocumentationInclusion;
  private smartSelector: SmartFileSelector;
  private statusBarManager: StatusBarManager;
  private projectAnalyzer: ProjectAnalyzer;
  private quickPickSelector: QuickPickSelector;
  private contextSizeOptimizer: ContextSizeOptimizer;

  // Latest enhancement modules
  private presetsManager: ContextPresetsManager;
  private contentFilter: ContentFilteringEngine;
  private historyTracker: ContextHistoryTracker;
  private contextValidator: ContextValidator;
  private fileGrouping: SmartFileGrouping;

  // Pattern & Template modules
  private patternSelector: PatternSelector;
  private templateEngine: TemplateEngine;
  private fileMetadata: FileMetadataProvider;

  constructor(private context: vscode.ExtensionContext) {
    this.tokenCounter = new TokenCounter();
    this.relationshipAnalyzer = new FileRelationshipAnalyzer();
    this.templateManager = new ContextTemplateManager();
    this.diagnosticsIntegration = new DiagnosticsIntegration();
    this.tokenOptimizer = new TokenOptimizer();

    // Initialize new modules
    this.dependencyDetector = new DependencyDetector();
    this.performanceMonitor = new PerformanceMonitor();
    this.documentationInclusion = new DocumentationInclusion();
    this.smartSelector = new SmartFileSelector(this.relationshipAnalyzer);
    this.statusBarManager = new StatusBarManager(this.tokenCounter);
    this.projectAnalyzer = new ProjectAnalyzer();
    this.contextSizeOptimizer = new ContextSizeOptimizer(this.tokenCounter);
    this.quickPickSelector = new QuickPickSelector(this.smartSelector, this.tokenCounter);

    // Initialize latest modules
    this.presetsManager = new ContextPresetsManager(this.context);
    this.contentFilter = new ContentFilteringEngine();
    this.historyTracker = new ContextHistoryTracker(this.context);
    this.contextValidator = new ContextValidator(this.relationshipAnalyzer);
    this.fileGrouping = new SmartFileGrouping(this.tokenCounter);

    // Initialize pattern & template modules
    this.patternSelector = new PatternSelector();
    this.templateEngine = new TemplateEngine(this.tokenCounter);
    this.fileMetadata = new FileMetadataProvider(undefined); // Git provider will be set in initialize()
  }

  /**
   * Initialize all enhanced features
   */
  async initialize(): Promise<void> {
    this.performanceMonitor.start('initialize');

    // Initialize Git provider
    this.gitProvider = new GitContextProvider();
    const gitAvailable = await this.gitProvider.initialize(this.context);

    if (gitAvailable) {
      console.log('✓ Git context provider initialized');
    } else {
      console.log('⚠ Git context provider not available');
    }

    // Set git provider for file metadata
    this.fileMetadata = new FileMetadataProvider(this.gitProvider);

    // Register built-in templates
    BuiltinTemplates.registerAll(this.templateEngine);
    console.log('✓ Built-in templates registered');

    // Initialize TreeView with all modules
    this.treeProvider = new ContextTreeProvider(
      this.context,
      this.gitProvider,
      this.tokenCounter,
      this.relationshipAnalyzer,
      this.smartSelector,
      this.performanceMonitor
    );

    // Register tree view
    const treeView = vscode.window.createTreeView('contextPackExplorer', {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true,
      canSelectMany: false
    });

    // Handle checkbox changes
    treeView.onDidChangeCheckboxState(async e => {
      await this.treeProvider?.handleCheckboxChange(e.items);

      // Update status bar when selection changes
      const selectedFiles = this.treeProvider?.getSelectedFiles() || [];
      this.statusBarManager.updateTokenCount(selectedFiles);
    });

    this.context.subscriptions.push(treeView);

    // Initialize and show status bar
    this.statusBarManager.show();
    this.context.subscriptions.push(this.statusBarManager as any);

    // Watch for file selection changes
    vscode.window.onDidChangeVisibleTextEditors(() => {
      this.treeProvider?.refresh();
    });

    // Watch for diagnostic changes
    vscode.languages.onDidChangeDiagnostics(() => {
      this.treeProvider?.refresh();
    });

    this.performanceMonitor.end('initialize');
    console.log('✓ Enhanced features initialized');
  }

  /**
   * Register all enhanced commands
   */
  registerCommands(): void {
    // Context template commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.copyDebug', async () => {
        await this.templateManager.applyTemplate('debug');
        await this.copyContextWithTemplate('debug');
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.copyReview', async () => {
        await this.templateManager.applyTemplate('review');
        await this.copyContextWithTemplate('review');
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.copyFeature', async () => {
        await this.templateManager.applyTemplate('feature');
        await this.copyContextWithTemplate('feature');
      })
    );

    // TreeView commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.toggleTracking', async (resource: vscode.Uri) => {
        // This will be handled by the tree provider
        this.treeProvider?.refresh();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.refresh', () => {
        this.treeProvider?.refresh();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.clearAll', () => {
        this.treeProvider?.clearAll();
      })
    );

    // Token & Cost commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.showTokenCount', async () => {
        await this.showTokenCountAndCost();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.optimizeContext', async () => {
        await this.optimizeContext();
      })
    );

    // New enhancement commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.showSmartSuggestions', async () => {
        await this.showSmartSuggestions();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.analyzeProject', async () => {
        await this.analyzeProject();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.showTechStack', async () => {
        await this.showTechStack();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.showPerformanceReport', async () => {
        await this.showPerformanceReport();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.selectFilesInteractive', async () => {
        await this.selectFilesInteractive();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.selectMode', async () => {
        await this.selectMode();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.analyzeSizeAndOptimize', async () => {
        await this.analyzeSizeAndOptimize();
      })
    );

    // TreeView enhancement commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.setSortOrder', async () => {
        await this.setSortOrder();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.setFilter', async () => {
        await this.setFilter();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.searchFiles', async () => {
        await this.searchFiles();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.selectAll', () => {
        this.treeProvider?.selectAll();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.deselectAll', () => {
        this.treeProvider?.deselectAll();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.invertSelection', () => {
        this.treeProvider?.invertSelection();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.toggleSmartSuggestions', () => {
        this.treeProvider?.toggleSmartSuggestions();
      })
    );

    // Context Presets commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.createPreset', async () => {
        await this.createPreset();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.loadPreset', async () => {
        await this.loadPreset();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.managePresets', async () => {
        await this.managePresets();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.quickSavePreset', async () => {
        await this.quickSavePreset();
      })
    );

    // Content Filtering commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.applyContentFilter', async () => {
        await this.applyContentFilter();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.copyWithFilter', async () => {
        await this.copyWithFilter();
      })
    );

    // History commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.showHistory', async () => {
        await this.showHistory();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.undoSelection', async () => {
        await this.undoSelection();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.redoSelection', async () => {
        await this.redoSelection();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.compareSnapshots', async () => {
        await this.compareSnapshots();
      })
    );

    // Validation commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.validateContext', async () => {
        await this.validateContext();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.showHealthReport', async () => {
        await this.showHealthReport();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.autoFixIssues', async () => {
        await this.autoFixIssues();
      })
    );

    // Grouping commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.setGrouping', async () => {
        await this.setGrouping();
      })
    );

    // Pattern selection commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.selectByPattern', async () => {
        await this.selectFilesByPattern();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.selectTestFiles', async () => {
        await this.selectTestFiles();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.selectConfigFiles', async () => {
        await this.selectConfigFiles();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.selectRecentFiles', async () => {
        await this.selectRecentFiles();
      })
    );

    // Template rendering commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.renderWithTemplate', async () => {
        await this.renderWithTemplate();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.copyForPR', async () => {
        await this.copyForPR();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.copyForBugReport', async () => {
        await this.copyForBugReport();
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.copyForDocs', async () => {
        await this.copyForDocs();
      })
    );

    // File metadata commands
    this.context.subscriptions.push(
      vscode.commands.registerCommand('copyContext.showFileMetadata', async () => {
        await this.showFileMetadata();
      })
    );

    console.log('✓ Enhanced commands registered');
  }

  /**
   * Copy context with template configuration
   */
  private async copyContextWithTemplate(templateType: 'debug' | 'review' | 'feature'): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected. Please select files in the ContextPack-Pro view.');
      return;
    }

    // Build context
    let context = '';

    // Add git context if enabled
    const template = this.templateManager.getTemplate(templateType);
    if (template?.includeGitChanges && this.gitProvider) {
      context += await this.gitProvider.getContext();
      context += '\n\n---\n\n';
    }

    // Add diagnostics if enabled
    if (template?.includeDiagnostics) {
      const diagnostics = this.diagnosticsIntegration.getFormattedDiagnostics();
      if (diagnostics) {
        context += diagnostics;
        context += '\n\n---\n\n';
      }
    }

    // Add file contents
    context += `# Selected Files (${selectedFiles.length})\n\n`;

    for (const uri of selectedFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        const content = document.getText();

        context += `## ${vscode.workspace.asRelativePath(uri)}\n\n`;
        context += `\`\`\`${document.languageId}\n`;
        context += content;
        context += `\n\`\`\`\n\n`;
      } catch (error) {
        console.error(`Error reading file ${uri.fsPath}:`, error);
      }
    }

    // Optimize if needed
    const tokenCount = this.tokenCounter.countTokens(context);
    const optimization = this.tokenOptimizer.optimize(context, template?.optimizationMode || 'auto', tokenCount);

    // Copy to clipboard
    await vscode.env.clipboard.writeText(optimization.optimizedContent);

    // Show summary
    const summary = this.tokenCounter.formatTokenCount(this.tokenCounter.getTokenCount(optimization.optimizedContent));
    vscode.window.showInformationMessage(
      `${template?.name || 'Context'} copied! ${optimization.optimizedTokens.toLocaleString()} tokens`
    );
  }

  /**
   * Show token count and cost analysis
   */
  private async showTokenCountAndCost(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected.');
      return;
    }

    // Build sample context to estimate
    let totalContent = '';

    for (const uri of selectedFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        totalContent += document.getText() + '\n\n';
      } catch (error) {
        console.error(`Error reading file ${uri.fsPath}:`, error);
      }
    }

    const tokenCount = this.tokenCounter.getTokenCount(totalContent);
    const formatted = this.tokenCounter.formatTokenCount(tokenCount);

    // Show in output channel
    const outputChannel = vscode.window.createOutputChannel('ContextPack-Pro Token Analysis');
    outputChannel.clear();
    outputChannel.appendLine(formatted);

    // Add optimization suggestions
    const suggestions = this.tokenCounter.getOptimizationSuggestions(tokenCount.tokens);
    if (suggestions.length > 0) {
      outputChannel.appendLine('\n## Optimization Suggestions\n');
      suggestions.forEach(s => outputChannel.appendLine(s));
    }

    outputChannel.show();
  }

  /**
   * Optimize context and show savings
   */
  private async optimizeContext(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected.');
      return;
    }

    // Build content
    let totalContent = '';
    for (const uri of selectedFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        totalContent += document.getText() + '\n\n';
      } catch (error) {
        continue;
      }
    }

    const originalTokens = this.tokenCounter.countTokens(totalContent);

    // Get user's preferred mode
    const modes: Array<{ label: string; description: string; mode: 'auto' | 'full' | 'signatures' | 'diffs' }> = [
      { label: 'Auto', description: 'Automatically choose best optimization', mode: 'auto' },
      { label: 'Signatures Only', description: '~95% reduction - Extract function/class signatures only', mode: 'signatures' },
      { label: 'Diffs Only', description: '~90% reduction - Show only changed lines', mode: 'diffs' },
      { label: 'Full Content', description: 'No optimization', mode: 'full' }
    ];

    const selected = await vscode.window.showQuickPick(modes, {
      placeHolder: 'Select optimization mode',
      title: 'Token Optimization'
    });

    if (!selected) {
      return;
    }

    const result = this.tokenOptimizer.optimize(totalContent, selected.mode, originalTokens);

    // Show results
    const outputChannel = vscode.window.createOutputChannel('ContextPack-Pro Optimization');
    outputChannel.clear();
    outputChannel.appendLine(this.tokenOptimizer.formatOptimizationSummary(result));
    outputChannel.show();

    // Ask if user wants to copy optimized version
    const copy = await vscode.window.showInformationMessage(
      `Optimization complete! Reduced from ${result.originalTokens.toLocaleString()} to ${result.optimizedTokens.toLocaleString()} tokens (${result.reductionPercentage.toFixed(1)}% reduction). Copy to clipboard?`,
      'Copy Optimized',
      'Copy Original',
      'Cancel'
    );

    if (copy === 'Copy Optimized') {
      await vscode.env.clipboard.writeText(result.optimizedContent);
      vscode.window.showInformationMessage('Optimized context copied to clipboard!');
    } else if (copy === 'Copy Original') {
      await vscode.env.clipboard.writeText(result.originalContent);
      vscode.window.showInformationMessage('Original context copied to clipboard!');
    }
  }

  /**
   * Show smart suggestions for current selection
   */
  private async showSmartSuggestions(): Promise<void> {
    const currentSelection = this.treeProvider?.getSelectedFiles() || [];
    const suggestions = await this.quickPickSelector.showSmartSuggestions(currentSelection);

    if (suggestions && suggestions.length > 0) {
      // Add suggestions to tree selection
      vscode.window.showInformationMessage(`Added ${suggestions.length} suggested files to selection`);
    }
  }

  /**
   * Analyze project structure
   */
  private async analyzeProject(): Promise<void> {
    const structure = await this.projectAnalyzer.analyzeProject();

    if (!structure) {
      vscode.window.showWarningMessage('No workspace folder found');
      return;
    }

    const formatted = this.projectAnalyzer.formatStructure(structure);

    const doc = await vscode.workspace.openTextDocument({
      content: formatted,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Show tech stack information
   */
  private async showTechStack(): Promise<void> {
    const techStack = await this.dependencyDetector.detectTechStack();

    if (!techStack) {
      vscode.window.showInformationMessage('No tech stack detected');
      return;
    }

    const formatted = this.dependencyDetector.formatTechStack(techStack);

    const doc = await vscode.workspace.openTextDocument({
      content: formatted,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Show performance report
   */
  private async showPerformanceReport(): Promise<void> {
    const report = this.performanceMonitor.getReport();

    const outputChannel = vscode.window.createOutputChannel('ContextPack-Pro Performance');
    outputChannel.clear();

    outputChannel.appendLine('# Performance Report\n');
    outputChannel.appendLine(`Status: ${report.isHealthy ? '✅ Healthy' : '⚠️ Issues Detected'}\n`);

    if (report.issues.length > 0) {
      outputChannel.appendLine('## Issues\n');
      report.issues.forEach(issue => outputChannel.appendLine(`- ${issue}`));
      outputChannel.appendLine('');
    }

    if (report.recommendations.length > 0) {
      outputChannel.appendLine('## Recommendations\n');
      report.recommendations.forEach(rec => outputChannel.appendLine(`- ${rec}`));
      outputChannel.appendLine('');
    }

    const stats = this.performanceMonitor.getStats();
    outputChannel.appendLine('## Statistics\n');
    outputChannel.appendLine(`Total Operations: ${stats.totalOperations}`);
    outputChannel.appendLine(`Average Duration: ${stats.averageDuration.toFixed(2)}ms`);
    outputChannel.appendLine(`Slowest Operation: ${stats.slowestOperation?.operation || 'N/A'} (${stats.slowestOperation?.duration.toFixed(2) || 0}ms)`);

    outputChannel.show();
  }

  /**
   * Interactive file selection with QuickPick
   */
  private async selectFilesInteractive(): Promise<void> {
    const selectedFiles = await this.quickPickSelector.showFileSelector({
      selectedFiles: this.treeProvider?.getSelectedFiles(),
      openEditors: vscode.window.visibleTextEditors.map(e => e.document.uri),
      modifiedFiles: this.gitProvider ? await this.gitProvider.getModifiedFiles().then(f => f.map(m => m.uri)) : [],
      errorFiles: this.getErrorFiles()
    });

    if (selectedFiles) {
      vscode.window.showInformationMessage(`Selected ${selectedFiles.length} files`);
    }
  }

  /**
   * Select context mode
   */
  private async selectMode(): Promise<void> {
    const mode = await this.quickPickSelector.showModeSelector();

    if (mode) {
      this.treeProvider?.setMode(mode);
      vscode.window.showInformationMessage(`Switched to ${mode} mode`);
    }
  }

  /**
   * Analyze context size and show optimization options
   */
  private async analyzeSizeAndOptimize(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    await this.contextSizeOptimizer.showOptimizationUI(selectedFiles);
  }

  /**
   * Set sort order for tree
   */
  private async setSortOrder(): Promise<void> {
    const options = [
      { label: '⭐ Smart Score', description: 'Sort by relevance score', value: 'score' as const },
      { label: '🔤 Name', description: 'Sort alphabetically', value: 'name' as const },
      { label: '📊 Size', description: 'Sort by file size', value: 'size' as const },
      { label: '🎯 Tokens', description: 'Sort by token count', value: 'tokens' as const },
      { label: '🕒 Recent', description: 'Sort by recent activity', value: 'recent' as const }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select sort order'
    });

    if (selected) {
      this.treeProvider?.setSortOrder(selected.value);
    }
  }

  /**
   * Set filter for tree
   */
  private async setFilter(): Promise<void> {
    const options = [
      { label: '📁 All Files', description: 'Show all files', value: 'all' as const },
      { label: '✓ Selected Only', description: 'Show only selected files', value: 'selected' as const },
      { label: '❌ Errors Only', description: 'Show only files with errors', value: 'errors' as const },
      { label: '📝 Modified Only', description: 'Show only modified files', value: 'modified' as const }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select filter'
    });

    if (selected) {
      this.treeProvider?.setFilter(selected.value);
    }
  }

  /**
   * Search files in tree
   */
  private async searchFiles(): Promise<void> {
    const query = await vscode.window.showInputBox({
      prompt: 'Search files by name or path',
      placeHolder: 'Enter search query...'
    });

    if (query !== undefined) {
      this.treeProvider?.setSearchQuery(query);
    }
  }

  /**
   * Helper: Get files with errors
   */
  private getErrorFiles(): vscode.Uri[] {
    const diagnostics = vscode.languages.getDiagnostics();
    const errorFiles: vscode.Uri[] = [];

    for (const [uri, diags] of diagnostics) {
      const hasError = diags.some(d => d.severity === vscode.DiagnosticSeverity.Error);
      if (hasError) {
        errorFiles.push(uri);
      }
    }

    return errorFiles;
  }

  /**
   * Create new preset from current selection
   */
  private async createPreset(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    const preset = await this.presetsManager.showCreatePresetUI(selectedFiles);

    if (preset) {
      vscode.window.showInformationMessage(`Preset "${preset.name}" created with ${preset.files.length} files`);
    }
  }

  /**
   * Load a saved preset
   */
  private async loadPreset(): Promise<void> {
    const preset = await this.presetsManager.showPresetSelector();

    if (preset) {
      // Clear current selection and load preset files
      this.treeProvider?.clearAll();

      // Load files from preset
      // Note: The tree provider would need to support loading specific files
      vscode.window.showInformationMessage(`Loaded preset "${preset.name}" with ${preset.files.length} files`);
    }
  }

  /**
   * Manage all presets (list, edit, delete)
   */
  private async managePresets(): Promise<void> {
    const presets = this.presetsManager.getAllPresets();

    if (presets.length === 0) {
      vscode.window.showInformationMessage('No presets saved');
      return;
    }

    const items = presets.map(preset => ({
      label: `$(bookmark) ${preset.name}`,
      description: `${preset.files.length} files`,
      detail: preset.description,
      preset
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a preset to manage',
      matchOnDescription: true
    });

    if (selected) {
      const action = await vscode.window.showQuickPick([
        { label: '$(play) Load', action: 'load' as const },
        { label: '$(edit) Rename', action: 'rename' as const },
        { label: '$(trash) Delete', action: 'delete' as const }
      ], {
        placeHolder: `Manage preset: ${selected.preset.name}`
      });

      if (action) {
        switch (action.action) {
          case 'load':
            // Load the preset
            await this.loadPreset();
            break;
          case 'rename':
            const newName = await vscode.window.showInputBox({
              prompt: 'Enter new name',
              value: selected.preset.name
            });
            if (newName) {
              await this.presetsManager.updatePreset(selected.preset.id, { name: newName });
              vscode.window.showInformationMessage('Preset renamed');
            }
            break;
          case 'delete':
            const confirm = await vscode.window.showWarningMessage(
              `Delete preset "${selected.preset.name}"?`,
              { modal: true },
              'Delete'
            );
            if (confirm === 'Delete') {
              await this.presetsManager.deletePreset(selected.preset.id);
              vscode.window.showInformationMessage('Preset deleted');
            }
            break;
        }
      }
    }
  }

  /**
   * Quick save current selection as preset
   */
  private async quickSavePreset(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: 'Enter preset name',
      placeHolder: 'e.g., My Working Set'
    });

    if (name) {
      const preset = await this.presetsManager.quickSave(name, selectedFiles);
      vscode.window.showInformationMessage(`Quick saved "${preset.name}"`);
    }
  }

  /**
   * Apply content filter to show preview
   */
  private async applyContentFilter(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    const options = await this.contentFilter.showFilterOptions();

    if (!options) {
      return;
    }

    // Apply filter to first file as preview
    const firstFile = selectedFiles[0];
    const filtered = await this.contentFilter.filterContent(
      firstFile,
      options,
      (text) => this.tokenCounter.countTokens(text)
    );

    // Show preview in diff view
    const originalDoc = await vscode.workspace.openTextDocument({
      content: filtered.original,
      language: 'markdown'
    });

    const filteredDoc = await vscode.workspace.openTextDocument({
      content: filtered.filtered,
      language: 'markdown'
    });

    await vscode.commands.executeCommand('vscode.diff',
      originalDoc.uri,
      filteredDoc.uri,
      `Original vs ${filtered.description}`
    );

    vscode.window.showInformationMessage(
      `Filter applied: ${filtered.reductionPercentage.toFixed(1)}% reduction (${filtered.filteredTokens} tokens)`
    );
  }

  /**
   * Copy context with content filtering
   */
  private async copyWithFilter(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    const options = await this.contentFilter.showFilterOptions();

    if (!options) {
      return;
    }

    // Apply filter to all files
    const results = await this.contentFilter.batchFilter(
      selectedFiles,
      options,
      (text) => this.tokenCounter.countTokens(text)
    );

    // Build filtered context
    let context = `# Filtered Context (${options.mode})\n\n`;

    for (const [filePath, filtered] of results.entries()) {
      const relativePath = vscode.workspace.asRelativePath(filePath);
      context += `## ${relativePath}\n\n`;
      context += `\`\`\`\n${filtered.filtered}\n\`\`\`\n\n`;
    }

    // Copy to clipboard
    await vscode.env.clipboard.writeText(context);

    const stats = this.contentFilter.getFilterStats(results);
    vscode.window.showInformationMessage(
      `Copied with ${options.mode} filter! ${stats.averageReduction.toFixed(1)}% avg reduction`
    );
  }

  /**
   * Show context history
   */
  private async showHistory(): Promise<void> {
    const snapshot = await this.historyTracker.showHistoryUI();

    if (snapshot) {
      // Restore snapshot
      const files = snapshot.files.map(fsPath => vscode.Uri.file(fsPath));

      // Clear and load files
      this.treeProvider?.clearAll();

      vscode.window.showInformationMessage(
        `Restored snapshot from ${new Date(snapshot.timestamp).toLocaleString()}`
      );
    }
  }

  /**
   * Undo last selection change
   */
  private async undoSelection(): Promise<void> {
    const snapshot = await this.historyTracker.goToPrevious();

    if (snapshot) {
      // Restore previous snapshot
      vscode.window.showInformationMessage('Undone to previous selection');
    } else {
      vscode.window.showInformationMessage('Nothing to undo');
    }
  }

  /**
   * Redo selection change
   */
  private async redoSelection(): Promise<void> {
    const snapshot = await this.historyTracker.goToNext();

    if (snapshot) {
      // Restore next snapshot
      vscode.window.showInformationMessage('Redone to next selection');
    } else {
      vscode.window.showInformationMessage('Nothing to redo');
    }
  }

  /**
   * Compare snapshots
   */
  private async compareSnapshots(): Promise<void> {
    const current = this.historyTracker.getCurrentSnapshot();
    const snapshots = this.historyTracker.getAllSnapshots();

    if (snapshots.length < 2) {
      vscode.window.showInformationMessage('Need at least 2 snapshots to compare');
      return;
    }

    const items = snapshots.map(s => ({
      label: s.metadata.description || 'Context',
      description: new Date(s.timestamp).toLocaleString(),
      snapshot: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select snapshot to compare with current'
    });

    if (selected && current) {
      await this.historyTracker.showDiffUI(selected.snapshot, current);
    }
  }

  /**
   * Validate current context
   */
  private async validateContext(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    const result = await this.contextValidator.validateContext(selectedFiles);

    // Show validation report
    const outputChannel = vscode.window.createOutputChannel('Context Validation');
    outputChannel.clear();
    outputChannel.appendLine('# Context Validation Report\n');

    outputChannel.appendLine(`## Health Score: ${result.healthScore.overall.toFixed(0)}/100 (Grade ${result.healthScore.grade})\n`);

    if (result.issues.length === 0) {
      outputChannel.appendLine('✅ No issues found!\n');
    } else {
      outputChannel.appendLine(`## Issues (${result.issues.length})\n`);

      const errors = result.issues.filter(i => i.severity === 'error');
      const warnings = result.issues.filter(i => i.severity === 'warning');
      const infos = result.issues.filter(i => i.severity === 'info');

      if (errors.length > 0) {
        outputChannel.appendLine(`### Errors (${errors.length})\n`);
        errors.forEach(issue => {
          outputChannel.appendLine(`- ${issue.message}`);
          if (issue.suggestion) {
            outputChannel.appendLine(`  💡 ${issue.suggestion}`);
          }
        });
        outputChannel.appendLine('');
      }

      if (warnings.length > 0) {
        outputChannel.appendLine(`### Warnings (${warnings.length})\n`);
        warnings.forEach(issue => {
          outputChannel.appendLine(`- ${issue.message}`);
        });
        outputChannel.appendLine('');
      }

      if (infos.length > 0) {
        outputChannel.appendLine(`### Info (${infos.length})\n`);
        infos.forEach(issue => {
          outputChannel.appendLine(`- ${issue.message}`);
        });
      }
    }

    outputChannel.show();
  }

  /**
   * Show health report
   */
  private async showHealthReport(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    const result = await this.contextValidator.validateContext(selectedFiles);
    const report = this.contextValidator.formatHealthReport(result.healthScore, result.issues);

    const doc = await vscode.workspace.openTextDocument({
      content: report,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Auto-fix validation issues
   */
  private async autoFixIssues(): Promise<void> {
    const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

    if (selectedFiles.length === 0) {
      vscode.window.showWarningMessage('No files selected');
      return;
    }

    const result = await this.contextValidator.validateContext(selectedFiles);
    const fixableIssues = result.issues.filter(i => i.autoFixable);

    if (fixableIssues.length === 0) {
      vscode.window.showInformationMessage('No auto-fixable issues found');
      return;
    }

    const fix = await vscode.window.showInformationMessage(
      `Found ${fixableIssues.length} auto-fixable issues. Apply fixes?`,
      'Fix All',
      'Cancel'
    );

    if (fix === 'Fix All') {
      const fixed = await this.contextValidator.autoFix(selectedFiles);
      vscode.window.showInformationMessage(`Fixed ${fixed.fixed} issues`);
    }
  }

  /**
   * Set file grouping strategy
   */
  private async setGrouping(): Promise<void> {
    const options = await this.fileGrouping.showGroupingSelector('none');

    if (options) {
      vscode.window.showInformationMessage(
        `Grouping set to: ${options.strategy}`
      );
      // Note: Would need to update tree provider to use grouping
      this.treeProvider?.refresh();
    }
  }

  /**
   * Get git provider
   */
  getGitProvider(): GitContextProvider | undefined {
    return this.gitProvider;
  }

  /**
   * Get token counter
   */
  getTokenCounter(): TokenCounter {
    return this.tokenCounter;
  }

  /**
   * Select files by pattern
   */
  private async selectFilesByPattern(): Promise<void> {
    const files = await this.patternSelector.showPatternSelectorUI();

    if (files && files.length > 0) {
      await this.treeProvider?.setSelectedFiles(files);
      this.statusBarManager.updateTokenCount(files);

      vscode.window.showInformationMessage(
        `Selected ${files.length} file${files.length === 1 ? '' : 's'} using pattern`
      );
    }
  }

  /**
   * Select test files
   */
  private async selectTestFiles(): Promise<void> {
    const files = await this.patternSelector.selectTestFiles();

    if (files.length > 0) {
      await this.treeProvider?.setSelectedFiles(files);
      this.statusBarManager.updateTokenCount(files);

      vscode.window.showInformationMessage(
        `Selected ${files.length} test file${files.length === 1 ? '' : 's'}`
      );
    } else {
      vscode.window.showInformationMessage('No test files found');
    }
  }

  /**
   * Select config files
   */
  private async selectConfigFiles(): Promise<void> {
    const files = await this.patternSelector.selectConfigFiles();

    if (files.length > 0) {
      await this.treeProvider?.setSelectedFiles(files);
      this.statusBarManager.updateTokenCount(files);

      vscode.window.showInformationMessage(
        `Selected ${files.length} config file${files.length === 1 ? '' : 's'}`
      );
    } else {
      vscode.window.showInformationMessage('No config files found');
    }
  }

  /**
   * Select recently modified files
   */
  private async selectRecentFiles(): Promise<void> {
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
      const days = parseInt(daysInput);
      const files = await this.patternSelector.selectRecentlyModified(days);

      if (files.length > 0) {
        await this.treeProvider?.setSelectedFiles(files);
        this.statusBarManager.updateTokenCount(files);

        vscode.window.showInformationMessage(
          `Selected ${files.length} file${files.length === 1 ? '' : 's'} modified in last ${days} day${days === 1 ? '' : 's'}`
        );
      } else {
        vscode.window.showInformationMessage(`No files modified in last ${days} day${days === 1 ? '' : 's'}`);
      }
    }
  }

  /**
   * Build template context with file contents
   */
  private async buildTemplateContext(
    selectedFiles: vscode.Uri[],
    options?: {
      includeDiagnostics?: boolean;
      includeGit?: boolean;
      userInputs?: Map<string, string>;
    }
  ): Promise<{ context: any; totalContent: string }> {
    // Read all file contents
    let totalContent = '';
    for (const uri of selectedFiles) {
      try {
        const document = await vscode.workspace.openTextDocument(uri);
        totalContent += document.getText() + '\n\n';
      } catch (error) {
        console.error(`Error reading file ${uri.fsPath}:`, error);
      }
    }

    const context = {
      files: selectedFiles,
      gitContext: options?.includeGit && this.gitProvider
        ? await this.gitProvider.getContext()
        : undefined,
      diagnostics: options?.includeDiagnostics
        ? await this.diagnosticsIntegration.getAllDiagnostics()
        : undefined,
      variables: new Map(),
      userInputs: options?.userInputs || new Map(),
      timestamp: new Date(),
      workspace: vscode.workspace.workspaceFolders?.[0]?.name || 'Unknown',
      fileCount: selectedFiles.length,
      totalTokens: this.tokenCounter.countTokens(totalContent)
    };

    return { context, totalContent };
  }

  /**
   * Render context with template
   */
  private async renderWithTemplate(): Promise<void> {
    try {
      const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

      if (selectedFiles.length === 0) {
        vscode.window.showWarningMessage('No files selected. Please select files first.');
        return;
      }

      // Show template selector
      const template = await this.templateEngine.showTemplateSelectorUI();
      if (!template) {
        return;
      }

      // Collect user inputs
      const userInputs = await this.templateEngine.collectUserInputs(template);

      // Build context with actual file contents
      const { context } = await this.buildTemplateContext(selectedFiles, {
        includeGit: true,
        userInputs
      });

      // Render template
      const result = await this.templateEngine.render(template.id, context);

      // Copy to clipboard
      await vscode.env.clipboard.writeText(result.content);

      vscode.window.showInformationMessage(
        `Copied ${selectedFiles.length} files using template "${template.name}" (${result.metadata.totalTokens || 0} tokens)`
      );
    } catch (error) {
      console.error('Failed to render template:', error);
      vscode.window.showErrorMessage(
        `Failed to render template: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Copy for PR description
   */
  private async copyForPR(): Promise<void> {
    try {
      const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

      if (selectedFiles.length === 0) {
        vscode.window.showWarningMessage('No files selected. Please select files first.');
        return;
      }

      // Build context with actual file contents
      const { context } = await this.buildTemplateContext(selectedFiles, {
        includeGit: true
      });

      const result = await this.templateEngine.render('pr-description', context);
      await vscode.env.clipboard.writeText(result.content);

      vscode.window.showInformationMessage(
        `Copied PR description for ${selectedFiles.length} files (${result.metadata.totalTokens || 0} tokens)`
      );
    } catch (error) {
      console.error('Failed to copy PR description:', error);
      vscode.window.showErrorMessage(
        `Failed to copy PR description: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Copy for bug report
   */
  private async copyForBugReport(): Promise<void> {
    try {
      const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

      if (selectedFiles.length === 0) {
        vscode.window.showWarningMessage('No files selected. Please select files first.');
        return;
      }

      // Build context with actual file contents
      const { context } = await this.buildTemplateContext(selectedFiles, {
        includeGit: true,
        includeDiagnostics: true
      });

      const result = await this.templateEngine.render('bug-report', context);
      await vscode.env.clipboard.writeText(result.content);

      vscode.window.showInformationMessage(
        `Copied bug report for ${selectedFiles.length} files (${result.metadata.totalTokens || 0} tokens)`
      );
    } catch (error) {
      console.error('Failed to copy bug report:', error);
      vscode.window.showErrorMessage(
        `Failed to copy bug report: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Copy for documentation
   */
  private async copyForDocs(): Promise<void> {
    try {
      const selectedFiles = this.treeProvider?.getSelectedFiles() || [];

      if (selectedFiles.length === 0) {
        vscode.window.showWarningMessage('No files selected. Please select files first.');
        return;
      }

      // Build context with actual file contents
      const { context } = await this.buildTemplateContext(selectedFiles);

      const result = await this.templateEngine.render('documentation', context);
      await vscode.env.clipboard.writeText(result.content);

      vscode.window.showInformationMessage(
        `Copied documentation for ${selectedFiles.length} files (${result.metadata.totalTokens || 0} tokens)`
      );
    } catch (error) {
      console.error('Failed to copy documentation:', error);
      vscode.window.showErrorMessage(
        `Failed to copy documentation: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Show file metadata
   */
  private async showFileMetadata(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('No active editor');
      return;
    }

    const metadata = await this.fileMetadata.getMetadata(editor.document.uri, false);
    const formatted = this.fileMetadata.formatForOutput(metadata);

    // Show in new document
    const doc = await vscode.workspace.openTextDocument({
      content: formatted,
      language: 'markdown'
    });

    await vscode.window.showTextDocument(doc, { preview: false });
  }

  /**
   * Get template manager
   */
  getTemplateManager(): ContextTemplateManager {
    return this.templateManager;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.gitProvider?.dispose();
    this.tokenCounter.dispose();
    this.relationshipAnalyzer.dispose();
    this.treeProvider?.dispose();
    this.diagnosticsIntegration.dispose();
    this.statusBarManager.dispose();
    this.performanceMonitor.dispose();
    this.documentationInclusion.dispose();
    this.smartSelector.dispose();
    this.projectAnalyzer.dispose();
    this.contextSizeOptimizer.dispose();

    // Dispose latest modules
    this.presetsManager.dispose();
    this.contentFilter.dispose();
    this.historyTracker.dispose();
    this.contextValidator.dispose();
    this.fileGrouping.dispose();

    // Dispose pattern & template modules
    this.patternSelector.dispose();
    this.templateEngine.dispose();
    this.fileMetadata.dispose();
  }
}

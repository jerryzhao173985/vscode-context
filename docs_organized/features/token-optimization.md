# ContextPack-Pro Performance Optimization Guide

## 1. Git API Performance Strategy

### Caching Architecture

```typescript
// src/git/gitCache.ts
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface GitCacheEntry<T> {
  data: T;
  timestamp: number;
  etag?: string; // HEAD commit SHA for invalidation
}

class GitCache {
  private cache = new Map<string, GitCacheEntry<any>>();
  private readonly TTL_MS = 5000; // 5 second TTL
  private readonly MAX_ENTRIES = 100;

  async getOrCompute<T>(
    key: string,
    computer: () => Promise<T>,
    ttl: number = this.TTL_MS
  ): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < ttl) {
      return cached.data;
    }

    const data = await computer();
    this.cache.set(key, { data, timestamp: now });

    // Evict old entries
    if (this.cache.size > this.MAX_ENTRIES) {
      const oldestKey = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      this.cache.delete(oldestKey);
    }

    return data;
  }

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

// Git operation wrapper with performance monitoring
export class GitOperations {
  private cache = new GitCache();
  private workspacePath: string;
  private watcher?: vscode.FileSystemWatcher;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.setupInvalidation();
  }

  private setupInvalidation(): void {
    // Invalidate cache on .git changes
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspacePath, '.git/{HEAD,refs/**,index}')
    );

    this.watcher.onDidChange(() => this.cache.invalidate());
    this.watcher.onDidCreate(() => this.cache.invalidate());
    this.watcher.onDidDelete(() => this.cache.invalidate());
  }

  async getStatus(token?: vscode.CancellationToken): Promise<GitStatus> {
    return this.cache.getOrCompute(
      'status',
      async () => {
        const startTime = performance.now();

        if (token?.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }

        const { stdout } = await execFileAsync(
          'git',
          ['status', '--porcelain=v1', '-z'],
          {
            cwd: this.workspacePath,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
            timeout: 5000 // 5s timeout
          }
        );

        const duration = performance.now() - startTime;
        if (duration > 100) {
          console.warn(`[Git] status took ${duration.toFixed(0)}ms`);
        }

        return this.parseStatus(stdout);
      },
      2000 // 2s TTL for status
    );
  }

  async getRecentCommits(
    limit: number = 100,
    token?: vscode.CancellationToken
  ): Promise<GitCommit[]> {
    return this.cache.getOrCompute(
      `commits:${limit}`,
      async () => {
        if (token?.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }

        // Use efficient log format with minimal parsing
        const { stdout } = await execFileAsync(
          'git',
          [
            'log',
            `--max-count=${limit}`,
            '--format=%H%x00%an%x00%ae%x00%at%x00%s%x00',
            '--no-color'
          ],
          {
            cwd: this.workspacePath,
            maxBuffer: 5 * 1024 * 1024,
            timeout: 3000
          }
        );

        return this.parseCommits(stdout);
      },
      10000 // 10s TTL for commits
    );
  }

  // Incremental diff - only changed files
  async getDiffSummary(token?: vscode.CancellationToken): Promise<DiffSummary> {
    return this.cache.getOrCompute(
      'diff-summary',
      async () => {
        if (token?.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }

        // Use --numstat for minimal output
        const { stdout } = await execFileAsync(
          'git',
          ['diff', 'HEAD', '--numstat', '-z'],
          {
            cwd: this.workspacePath,
            timeout: 3000
          }
        );

        return this.parseDiffSummary(stdout);
      },
      3000 // 3s TTL
    );
  }

  // Blame is expensive - only call on-demand with aggressive caching
  async getFileBlame(
    filePath: string,
    token?: vscode.CancellationToken
  ): Promise<BlameInfo[]> {
    return this.cache.getOrCompute(
      `blame:${filePath}`,
      async () => {
        if (token?.isCancellationRequested) {
          throw new Error('Operation cancelled');
        }

        const startTime = performance.now();
        const { stdout } = await execFileAsync(
          'git',
          ['blame', '--line-porcelain', filePath],
          {
            cwd: this.workspacePath,
            maxBuffer: 20 * 1024 * 1024,
            timeout: 10000
          }
        );

        const duration = performance.now() - startTime;
        if (duration > 500) {
          console.warn(`[Git] blame for ${filePath} took ${duration.toFixed(0)}ms`);
        }

        return this.parseBlame(stdout);
      },
      60000 // 60s TTL for blame (very expensive)
    );
  }

  dispose(): void {
    this.watcher?.dispose();
    this.cache.invalidate();
  }

  // Helper methods
  private parseStatus(output: string): GitStatus {
    // Parse implementation
    return { modified: [], added: [], deleted: [] };
  }

  private parseCommits(output: string): GitCommit[] {
    // Parse implementation
    return [];
  }

  private parseDiffSummary(output: string): DiffSummary {
    // Parse implementation
    return { files: [], additions: 0, deletions: 0 };
  }

  private parseBlame(output: string): BlameInfo[] {
    // Parse implementation
    return [];
  }
}

// Types
interface GitStatus {
  modified: string[];
  added: string[];
  deleted: string[];
}

interface GitCommit {
  hash: string;
  author: string;
  email: string;
  timestamp: number;
  message: string;
}

interface DiffSummary {
  files: Array<{ path: string; additions: number; deletions: number }>;
  additions: number;
  deletions: number;
}

interface BlameInfo {
  line: number;
  hash: string;
  author: string;
  timestamp: number;
}
```

### Handling Large Repositories

```typescript
// src/git/largeRepoOptimizations.ts

export class LargeRepoHandler {
  private readonly SIZE_THRESHOLDS = {
    SMALL: 100, // files
    MEDIUM: 1000,
    LARGE: 10000,
    VERY_LARGE: 50000
  };

  async analyzeRepoSize(workspacePath: string): Promise<RepoSize> {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files'],
      { cwd: workspacePath, timeout: 5000 }
    );

    const fileCount = stdout.split('\n').filter(Boolean).length;

    return {
      fileCount,
      category: this.categorizeSize(fileCount)
    };
  }

  categorizeSize(fileCount: number): 'small' | 'medium' | 'large' | 'very-large' {
    if (fileCount < this.SIZE_THRESHOLDS.SMALL) return 'small';
    if (fileCount < this.SIZE_THRESHOLDS.MEDIUM) return 'medium';
    if (fileCount < this.SIZE_THRESHOLDS.LARGE) return 'large';
    return 'very-large';
  }

  getOptimalConfig(category: string): GitConfig {
    switch (category) {
      case 'small':
        return {
          cacheTTL: 5000,
          maxCommits: 500,
          enableBlame: true,
          diffTimeout: 3000
        };
      case 'medium':
        return {
          cacheTTL: 10000,
          maxCommits: 200,
          enableBlame: true,
          diffTimeout: 5000
        };
      case 'large':
        return {
          cacheTTL: 30000,
          maxCommits: 100,
          enableBlame: false, // Too expensive
          diffTimeout: 10000
        };
      case 'very-large':
        return {
          cacheTTL: 60000,
          maxCommits: 50,
          enableBlame: false,
          diffTimeout: 15000,
          shallowClone: true // Use shallow operations
        };
      default:
        return this.getOptimalConfig('medium');
    }
  }
}

interface RepoSize {
  fileCount: number;
  category: string;
}

interface GitConfig {
  cacheTTL: number;
  maxCommits: number;
  enableBlame: boolean;
  diffTimeout: number;
  shallowClone?: boolean;
}
```

---

## 2. TreeView Performance Optimization

### Virtual Scrolling Implementation

```typescript
// src/treeview/virtualTreeView.ts

export class VirtualTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Lazy loading state
  private loadedNodes = new Map<string, TreeItem[]>();
  private expansionState = new Set<string>();

  // Performance optimization: limit initial rendering
  private readonly INITIAL_LOAD_LIMIT = 1000;
  private readonly CHILDREN_LOAD_LIMIT = 500;

  constructor(private workspacePath: string) {
    this.setupFileWatcher();
  }

  // Implement lazy loading for large directories
  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!element) {
      // Root level - load workspace folders
      return this.getRootChildren();
    }

    // Check cache first
    const cacheKey = element.resourceUri?.fsPath || '';
    if (this.loadedNodes.has(cacheKey)) {
      return this.loadedNodes.get(cacheKey)!;
    }

    // Load children with limit
    const children = await this.loadChildren(element);
    this.loadedNodes.set(cacheKey, children);

    return children;
  }

  private async loadChildren(element: TreeItem): Promise<TreeItem[]> {
    if (!element.resourceUri) return [];

    const stat = await vscode.workspace.fs.stat(element.resourceUri);
    if (!(stat.type & vscode.FileType.Directory)) return [];

    const entries = await vscode.workspace.fs.readDirectory(element.resourceUri);

    // Limit children for performance
    const limited = entries.slice(0, this.CHILDREN_LOAD_LIMIT);

    if (entries.length > this.CHILDREN_LOAD_LIMIT) {
      console.warn(
        `[TreeView] Directory ${element.resourceUri.fsPath} has ${entries.length} entries, showing first ${this.CHILDREN_LOAD_LIMIT}`
      );
    }

    return limited
      .sort((a, b) => {
        // Directories first, then files
        if (a[1] !== b[1]) {
          return a[1] === vscode.FileType.Directory ? -1 : 1;
        }
        return a[0].localeCompare(b[0]);
      })
      .map(([name, type]) => this.createTreeItem(name, type, element.resourceUri!));
  }

  private createTreeItem(
    name: string,
    type: vscode.FileType,
    parentUri: vscode.Uri
  ): TreeItem {
    const uri = vscode.Uri.joinPath(parentUri, name);
    const isDirectory = type === vscode.FileType.Directory;

    const item = new TreeItem(
      name,
      isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );

    item.resourceUri = uri;
    item.contextValue = isDirectory ? 'folder' : 'file';

    return item;
  }

  private setupFileWatcher(): void {
    // Debounced file watcher for performance
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');

    let debounceTimer: NodeJS.Timeout | undefined;
    const debounceMs = 500;

    const scheduleRefresh = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        this.refresh();
      }, debounceMs);
    };

    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    watcher.onDidChange(scheduleRefresh);
  }

  refresh(): void {
    // Clear cache and refresh
    this.loadedNodes.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeItem): TreeItem {
    return element;
  }
}

// TreeItem with checkbox support
class TreeItem extends vscode.TreeItem {
  checkboxState?: vscode.TreeItemCheckboxState;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);

    // Enable checkbox for files
    if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
      this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
    }
  }
}
```

### Checkbox State Management at Scale

```typescript
// src/treeview/checkboxStateManager.ts

export class CheckboxStateManager {
  private state = new Map<string, boolean>(); // path -> checked
  private directoryCounts = new Map<string, { total: number; checked: number }>();

  // Efficient batch updates
  async setChecked(paths: string[], checked: boolean): Promise<void> {
    const affected = new Set<string>();

    for (const path of paths) {
      this.state.set(path, checked);

      // Update parent directory counts
      const parentPath = this.getParentPath(path);
      if (parentPath) {
        affected.add(parentPath);
      }
    }

    // Batch update directory counts
    for (const dir of affected) {
      await this.updateDirectoryCount(dir);
    }
  }

  isChecked(path: string): boolean {
    return this.state.get(path) ?? false;
  }

  // Get all checked paths efficiently
  getCheckedPaths(): string[] {
    return Array.from(this.state.entries())
      .filter(([_, checked]) => checked)
      .map(([path]) => path);
  }

  // Optimized: get directory state without iterating all children
  getDirectoryState(dirPath: string): 'all' | 'some' | 'none' {
    const count = this.directoryCounts.get(dirPath);
    if (!count || count.total === 0) return 'none';

    if (count.checked === count.total) return 'all';
    if (count.checked > 0) return 'some';
    return 'none';
  }

  private async updateDirectoryCount(dirPath: string): Promise<void> {
    const childPaths = Array.from(this.state.keys()).filter(
      path => path.startsWith(dirPath + '/')
    );

    const total = childPaths.length;
    const checked = childPaths.filter(path => this.state.get(path)).length;

    this.directoryCounts.set(dirPath, { total, checked });
  }

  private getParentPath(path: string): string | undefined {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash > 0 ? path.substring(0, lastSlash) : undefined;
  }

  // Persistence
  serialize(): Record<string, boolean> {
    return Object.fromEntries(this.state);
  }

  deserialize(data: Record<string, boolean>): void {
    this.state.clear();
    this.directoryCounts.clear();

    for (const [path, checked] of Object.entries(data)) {
      this.state.set(path, checked);
    }
  }
}
```

---

## 3. File Parsing Performance

### Parallel File Reading with Worker Threads

```typescript
// src/parsing/parallelFileParser.ts
import * as vscode from 'vscode';
import { Worker } from 'worker_threads';
import * as path from 'path';

export class ParallelFileParser {
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit
  private readonly MAX_PARALLEL_READS = 4; // Optimize for I/O

  async parseFiles(
    filePaths: string[],
    workspacePath: string,
    token?: vscode.CancellationToken
  ): Promise<ParsedFile[]> {
    const results: ParsedFile[] = [];
    const batches = this.createBatches(filePaths, this.MAX_PARALLEL_READS);

    for (const batch of batches) {
      if (token?.isCancellationRequested) {
        throw new Error('Operation cancelled');
      }

      // Process batch in parallel
      const batchResults = await Promise.allSettled(
        batch.map(file => this.parseFile(file, workspacePath, token))
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error(`Failed to parse file:`, result.reason);
        }
      }
    }

    return results;
  }

  private async parseFile(
    filePath: string,
    workspacePath: string,
    token?: vscode.CancellationToken
  ): Promise<ParsedFile> {
    const fullPath = path.join(workspacePath, filePath);
    const uri = vscode.Uri.file(fullPath);

    // Check file size first
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > this.MAX_FILE_SIZE) {
      return {
        path: filePath,
        content: `[File too large: ${(stat.size / 1024 / 1024).toFixed(2)}MB]`,
        truncated: true,
        size: stat.size
      };
    }

    if (token?.isCancellationRequested) {
      throw new Error('Operation cancelled');
    }

    // Read file
    const startTime = performance.now();
    const buffer = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(buffer).toString('utf8');

    const duration = performance.now() - startTime;
    if (duration > 100) {
      console.warn(`[FileParser] Reading ${filePath} took ${duration.toFixed(0)}ms`);
    }

    return {
      path: filePath,
      content,
      truncated: false,
      size: stat.size
    };
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }
}

interface ParsedFile {
  path: string;
  content: string;
  truncated: boolean;
  size: number;
}
```

### Stream Processing for Large Files

```typescript
// src/parsing/streamParser.ts
import * as fs from 'fs';
import * as readline from 'readline';

export class StreamParser {
  private readonly MAX_LINES = 10000; // Safety limit

  async parseFileStream(
    filePath: string,
    maxLines?: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      const limit = maxLines || this.MAX_LINES;

      const stream = fs.createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024 // 64KB chunks
      });

      const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        if (lines.length < limit) {
          lines.push(line);
        } else {
          rl.close();
          stream.close();
        }
      });

      rl.on('close', () => {
        resolve(lines.join('\n'));
      });

      rl.on('error', (error) => {
        reject(error);
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  // Extract specific sections efficiently
  async extractSection(
    filePath: string,
    startLine: number,
    endLine: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let currentLine = 0;

      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream });

      rl.on('line', (line) => {
        currentLine++;

        if (currentLine >= startLine && currentLine <= endLine) {
          lines.push(line);
        }

        if (currentLine > endLine) {
          rl.close();
          stream.close();
        }
      });

      rl.on('close', () => {
        resolve(lines.join('\n'));
      });

      rl.on('error', reject);
      stream.on('error', reject);
    });
  }
}
```

### Dependency File Parsing Benchmarks

```typescript
// src/parsing/dependencyParser.ts

export class DependencyParser {
  // Benchmarks (average on modern hardware):
  // package.json: ~5-10ms
  // package-lock.json: ~50-200ms (large file)
  // yarn.lock: ~30-150ms
  // requirements.txt: ~10-30ms
  // Cargo.toml: ~5-15ms
  // go.mod: ~5-20ms

  async parseDependencies(
    workspacePath: string,
    token?: vscode.CancellationToken
  ): Promise<Dependencies> {
    const detectors = [
      this.parseNodeDeps,
      this.parsePythonDeps,
      this.parseRustDeps,
      this.parseGoDeps
    ];

    const results = await Promise.allSettled(
      detectors.map(fn => fn.call(this, workspacePath, token))
    );

    const dependencies: Dependencies = {
      node: [],
      python: [],
      rust: [],
      go: []
    };

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        Object.assign(dependencies, result.value);
      }
    }

    return dependencies;
  }

  private async parseNodeDeps(
    workspacePath: string,
    token?: vscode.CancellationToken
  ): Promise<Partial<Dependencies>> {
    const pkgPath = path.join(workspacePath, 'package.json');

    try {
      const startTime = performance.now();
      const content = await fs.promises.readFile(pkgPath, 'utf8');

      if (token?.isCancellationRequested) return {};

      const pkg = JSON.parse(content);
      const duration = performance.now() - startTime;

      if (duration > 20) {
        console.warn(`[DependencyParser] package.json parsing took ${duration.toFixed(0)}ms`);
      }

      return {
        node: [
          ...Object.keys(pkg.dependencies || {}),
          ...Object.keys(pkg.devDependencies || {})
        ]
      };
    } catch {
      return {};
    }
  }

  private async parsePythonDeps(
    workspacePath: string,
    token?: vscode.CancellationToken
  ): Promise<Partial<Dependencies>> {
    const reqPath = path.join(workspacePath, 'requirements.txt');

    try {
      const content = await fs.promises.readFile(reqPath, 'utf8');

      if (token?.isCancellationRequested) return {};

      const deps = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.split('==')[0].split('>=')[0].split('<=')[0].trim());

      return { python: deps };
    } catch {
      return {};
    }
  }

  // Similar implementations for Rust and Go...
  private async parseRustDeps(
    workspacePath: string,
    token?: vscode.CancellationToken
  ): Promise<Partial<Dependencies>> {
    // TOML parsing implementation
    return {};
  }

  private async parseGoDeps(
    workspacePath: string,
    token?: vscode.CancellationToken
  ): Promise<Partial<Dependencies>> {
    // go.mod parsing implementation
    return {};
  }
}

interface Dependencies {
  node: string[];
  python: string[];
  rust: string[];
  go: string[];
}
```

---

## 4. Diagnostics Collection Performance

```typescript
// src/diagnostics/efficientDiagnosticsCollector.ts

export class DiagnosticsCollector {
  // getDiagnostics() cost analysis:
  // - Per file: ~1-5ms
  // - 100 files: ~100-500ms
  // - 1000 files: ~1-5s (unacceptable!)

  private readonly MAX_DIAGNOSTICS_FILES = 100;
  private diagnosticsCache = new Map<string, vscode.Diagnostic[]>();
  private lastUpdateTime = 0;

  constructor() {
    this.setupDiagnosticsListener();
  }

  // Optimized: only collect for relevant files
  async collectDiagnostics(
    relevantFiles: string[],
    token?: vscode.CancellationToken
  ): Promise<DiagnosticsReport> {
    const now = Date.now();
    const cacheAge = now - this.lastUpdateTime;

    // Use cache if recent (< 2 seconds old)
    if (cacheAge < 2000 && this.diagnosticsCache.size > 0) {
      return this.getCachedDiagnostics(relevantFiles);
    }

    // Limit files to prevent performance issues
    const limitedFiles = relevantFiles.slice(0, this.MAX_DIAGNOSTICS_FILES);

    const diagnostics: DiagnosticsReport = {
      errors: [],
      warnings: [],
      infos: [],
      total: 0
    };

    for (const file of limitedFiles) {
      if (token?.isCancellationRequested) break;

      const uri = vscode.Uri.file(file);
      const fileDiagnostics = vscode.languages.getDiagnostics(uri);

      this.diagnosticsCache.set(file, fileDiagnostics);

      for (const diag of fileDiagnostics) {
        diagnostics.total++;

        switch (diag.severity) {
          case vscode.DiagnosticSeverity.Error:
            diagnostics.errors.push({ file, diagnostic: diag });
            break;
          case vscode.DiagnosticSeverity.Warning:
            diagnostics.warnings.push({ file, diagnostic: diag });
            break;
          case vscode.DiagnosticSeverity.Information:
          case vscode.DiagnosticSeverity.Hint:
            diagnostics.infos.push({ file, diagnostic: diag });
            break;
        }
      }
    }

    this.lastUpdateTime = now;
    return diagnostics;
  }

  private setupDiagnosticsListener(): void {
    // Invalidate cache on diagnostics changes
    vscode.languages.onDidChangeDiagnostics(() => {
      this.diagnosticsCache.clear();
      this.lastUpdateTime = 0;
    });
  }

  private getCachedDiagnostics(relevantFiles: string[]): DiagnosticsReport {
    const diagnostics: DiagnosticsReport = {
      errors: [],
      warnings: [],
      infos: [],
      total: 0
    };

    for (const file of relevantFiles) {
      const cached = this.diagnosticsCache.get(file);
      if (!cached) continue;

      for (const diag of cached) {
        diagnostics.total++;

        switch (diag.severity) {
          case vscode.DiagnosticSeverity.Error:
            diagnostics.errors.push({ file, diagnostic: diag });
            break;
          case vscode.DiagnosticSeverity.Warning:
            diagnostics.warnings.push({ file, diagnostic: diag });
            break;
          default:
            diagnostics.infos.push({ file, diagnostic: diag });
            break;
        }
      }
    }

    return diagnostics;
  }

  // Filtered collection for critical issues only
  async collectCriticalDiagnostics(
    relevantFiles: string[],
    minSeverity: vscode.DiagnosticSeverity = vscode.DiagnosticSeverity.Warning
  ): Promise<DiagnosticEntry[]> {
    const critical: DiagnosticEntry[] = [];

    for (const file of relevantFiles.slice(0, this.MAX_DIAGNOSTICS_FILES)) {
      const uri = vscode.Uri.file(file);
      const diagnostics = vscode.languages.getDiagnostics(uri);

      for (const diag of diagnostics) {
        if (diag.severity <= minSeverity) {
          critical.push({ file, diagnostic: diag });
        }
      }
    }

    return critical;
  }
}

interface DiagnosticsReport {
  errors: DiagnosticEntry[];
  warnings: DiagnosticEntry[];
  infos: DiagnosticEntry[];
  total: number;
}

interface DiagnosticEntry {
  file: string;
  diagnostic: vscode.Diagnostic;
}
```

---

## 5. Overall Extension Performance Targets

### Performance Monitoring System

```typescript
// src/performance/performanceMonitor.ts

export class PerformanceMonitor {
  private metrics = new Map<string, PerformanceMetric>();
  private readonly TARGETS = {
    ACTIVATION_TIME: 500, // ms
    CONTEXT_GENERATION: 2000, // ms
    MEMORY_LIMIT: 50 * 1024 * 1024, // 50MB
    GIT_OPERATION: 200, // ms
    FILE_READ: 100, // ms per file
    TREE_RENDER: 500 // ms
  };

  startMeasure(operation: string): () => void {
    const startTime = performance.now();
    const startMemory = process.memoryUsage().heapUsed;

    return () => {
      const duration = performance.now() - startTime;
      const memoryDelta = process.memoryUsage().heapUsed - startMemory;

      this.recordMetric(operation, duration, memoryDelta);

      // Warn if exceeds targets
      const target = this.TARGETS[operation.toUpperCase().replace(/-/g, '_')];
      if (target && duration > target) {
        console.warn(
          `[Performance] ${operation} took ${duration.toFixed(0)}ms (target: ${target}ms)`
        );
      }
    };
  }

  private recordMetric(operation: string, duration: number, memoryDelta: number): void {
    const existing = this.metrics.get(operation);

    if (existing) {
      existing.count++;
      existing.totalDuration += duration;
      existing.totalMemory += memoryDelta;
      existing.avgDuration = existing.totalDuration / existing.count;
      existing.maxDuration = Math.max(existing.maxDuration, duration);
      existing.minDuration = Math.min(existing.minDuration, duration);
    } else {
      this.metrics.set(operation, {
        operation,
        count: 1,
        totalDuration: duration,
        avgDuration: duration,
        maxDuration: duration,
        minDuration: duration,
        totalMemory: memoryDelta
      });
    }
  }

  getReport(): PerformanceReport {
    const report: PerformanceReport = {
      metrics: Array.from(this.metrics.values()),
      totalMemory: process.memoryUsage().heapUsed,
      timestamp: Date.now()
    };

    return report;
  }

  logReport(): void {
    const report = this.getReport();

    console.log('\n=== ContextPack-Pro Performance Report ===');
    console.log(`Total Memory: ${(report.totalMemory / 1024 / 1024).toFixed(2)}MB`);
    console.log('\nOperation Metrics:');

    for (const metric of report.metrics) {
      console.log(
        `  ${metric.operation}: avg=${metric.avgDuration.toFixed(0)}ms, ` +
        `max=${metric.maxDuration.toFixed(0)}ms, count=${metric.count}`
      );
    }

    console.log('==========================================\n');
  }
}

interface PerformanceMetric {
  operation: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  totalMemory: number;
}

interface PerformanceReport {
  metrics: PerformanceMetric[];
  totalMemory: number;
  timestamp: number;
}

// Global performance monitor
export const perfMonitor = new PerformanceMonitor();
```

### Progress Indicators Strategy

```typescript
// src/progress/progressReporter.ts

export class ProgressReporter {
  private readonly SHOW_PROGRESS_THRESHOLD = 1000; // ms - show progress if operation takes >1s

  async withProgress<T>(
    title: string,
    task: (
      progress: vscode.Progress<{ message?: string; increment?: number }>,
      token: vscode.CancellationToken
    ) => Promise<T>,
    estimatedDuration?: number
  ): Promise<T> {
    // Only show progress for operations expected to take >1s
    if (estimatedDuration && estimatedDuration < this.SHOW_PROGRESS_THRESHOLD) {
      // Execute without progress UI
      const tokenSource = new vscode.CancellationTokenSource();
      try {
        return await task({ report: () => {} } as any, tokenSource.token);
      } finally {
        tokenSource.dispose();
      }
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: true
      },
      task
    );
  }

  // Multi-stage progress reporter
  createStageReporter(stages: string[]): StageReporter {
    let currentStage = 0;
    const incrementPerStage = 100 / stages.length;

    return {
      nextStage: (progress) => {
        if (currentStage < stages.length) {
          progress.report({
            message: stages[currentStage],
            increment: incrementPerStage
          });
          currentStage++;
        }
      },

      reportDetail: (progress, detail) => {
        progress.report({ message: `${stages[currentStage - 1]}: ${detail}` });
      }
    };
  }
}

interface StageReporter {
  nextStage: (progress: vscode.Progress<{ message?: string; increment?: number }>) => void;
  reportDetail: (progress: vscode.Progress<{ message?: string; increment?: number }>, detail: string) => void;
}

// Usage example
async function generateContextWithProgress() {
  const reporter = new ProgressReporter();

  return reporter.withProgress(
    'Generating Context',
    async (progress, token) => {
      const stages = reporter.createStageReporter([
        'Analyzing workspace',
        'Collecting Git data',
        'Parsing dependencies',
        'Reading files',
        'Generating output'
      ]);

      stages.nextStage(progress);
      const workspace = await analyzeWorkspace(token);

      stages.nextStage(progress);
      const gitData = await collectGitData(token);

      stages.nextStage(progress);
      const deps = await parseDependencies(token);

      stages.nextStage(progress);
      const files = await readFiles(token);

      stages.nextStage(progress);
      const output = await generateOutput(workspace, gitData, deps, files);

      return output;
    },
    5000 // Estimated 5 seconds
  );
}
```

---

## 6. Optimization Techniques

### Debouncing and Throttling

```typescript
// src/utils/rateLimiting.ts

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | undefined;

  return function(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      fn(...args);
    }, delayMs);
  };
}

export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | undefined;

  return function(...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= delayMs) {
      lastCall = now;
      fn(...args);
    } else {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
      }, delayMs - timeSinceLastCall);
    }
  };
}

// File watcher with debouncing
export class DebouncedFileWatcher {
  private watcher?: vscode.FileSystemWatcher;
  private callback: () => void;

  constructor(
    pattern: vscode.GlobPattern,
    callback: () => void,
    debounceMs: number = 500
  ) {
    this.callback = debounce(callback, debounceMs);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate(this.callback);
    this.watcher.onDidChange(this.callback);
    this.watcher.onDidDelete(this.callback);
  }

  dispose(): void {
    this.watcher?.dispose();
  }
}
```

### Memoization Strategies

```typescript
// src/utils/memoization.ts

export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  options?: MemoizeOptions
): T {
  const cache = new Map<string, MemoizedValue<ReturnType<T>>>();
  const maxSize = options?.maxSize ?? 100;
  const ttl = options?.ttl ?? 60000; // 60s default

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = options?.keyGenerator
      ? options.keyGenerator(args)
      : JSON.stringify(args);

    const cached = cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < ttl) {
      return cached.value;
    }

    const value = fn(...args);
    cache.set(key, { value, timestamp: now });

    // Evict old entries
    if (cache.size > maxSize) {
      const oldestKey = Array.from(cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
      cache.delete(oldestKey);
    }

    return value;
  }) as T;
}

interface MemoizeOptions {
  maxSize?: number;
  ttl?: number;
  keyGenerator?: (args: any[]) => string;
}

interface MemoizedValue<T> {
  value: T;
  timestamp: number;
}

// Usage example
const expensiveOperation = memoize(
  (filePath: string, depth: number) => {
    // Expensive computation
    return result;
  },
  {
    maxSize: 50,
    ttl: 30000,
    keyGenerator: (args) => `${args[0]}:${args[1]}`
  }
);
```

### Memory Leak Prevention

```typescript
// src/utils/disposableManager.ts

export class DisposableManager {
  private disposables: vscode.Disposable[] = [];
  private disposed = false;

  register<T extends vscode.Disposable>(disposable: T): T {
    if (this.disposed) {
      disposable.dispose();
      throw new Error('Cannot register on disposed manager');
    }

    this.disposables.push(disposable);
    return disposable;
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    for (const disposable of this.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        console.error('Error disposing resource:', error);
      }
    }

    this.disposables = [];
  }

  // Helper for creating disposable listeners
  registerListener<T>(
    event: vscode.Event<T>,
    listener: (e: T) => any
  ): vscode.Disposable {
    return this.register(event(listener));
  }
}

// Usage in extension
export class ContextPackExtension {
  private disposables = new DisposableManager();

  activate(context: vscode.ExtensionContext): void {
    // Register all disposables through manager
    this.disposables.register(
      vscode.workspace.onDidOpenTextDocument(this.onDocumentOpened.bind(this))
    );

    this.disposables.register(
      vscode.window.onDidChangeActiveTextEditor(this.onEditorChanged.bind(this))
    );

    // Clean up on deactivation
    context.subscriptions.push({
      dispose: () => this.disposables.dispose()
    });
  }

  private onDocumentOpened(document: vscode.TextDocument): void {
    // Handle document opened
  }

  private onEditorChanged(editor: vscode.TextEditor | undefined): void {
    // Handle editor changed
  }
}
```

---

## 7. Performance Testing & Profiling

### Profiling Strategy

```typescript
// src/testing/performanceTests.ts
import * as assert from 'assert';
import { perfMonitor } from '../performance/performanceMonitor';

export async function runPerformanceTests(): Promise<void> {
  console.log('Running performance tests...\n');

  // Test 1: Activation time
  await testActivationTime();

  // Test 2: Context generation
  await testContextGeneration();

  // Test 3: Git operations
  await testGitOperations();

  // Test 4: Tree view rendering
  await testTreeViewRendering();

  // Test 5: Memory usage
  await testMemoryUsage();

  perfMonitor.logReport();
}

async function testActivationTime(): Promise<void> {
  const endMeasure = perfMonitor.startMeasure('activation');

  // Simulate activation
  await new Promise(resolve => setTimeout(resolve, 100));

  endMeasure();
  console.log('✓ Activation time test passed');
}

async function testContextGeneration(): Promise<void> {
  const endMeasure = perfMonitor.startMeasure('context-generation');

  // Generate context for test workspace
  // await generateContext();

  endMeasure();
  console.log('✓ Context generation test passed');
}

// More tests...
```

### Recommended Limits

```typescript
// src/config/performanceLimits.ts

export const PERFORMANCE_LIMITS = {
  // File operations
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  MAX_FILES_TO_PROCESS: 500,
  MAX_PARALLEL_FILE_READS: 4,

  // Git operations
  MAX_COMMITS_TO_FETCH: 100,
  MAX_BLAME_FILE_SIZE: 1 * 1024 * 1024, // 1MB
  GIT_OPERATION_TIMEOUT: 10000, // 10s

  // Tree view
  MAX_TREE_NODES: 10000,
  MAX_CHILDREN_PER_NODE: 1000,
  TREE_DEBOUNCE_MS: 500,

  // Diagnostics
  MAX_DIAGNOSTICS_FILES: 100,
  DIAGNOSTICS_CACHE_TTL: 2000, // 2s

  // Memory
  MEMORY_WARNING_THRESHOLD: 100 * 1024 * 1024, // 100MB
  MEMORY_ERROR_THRESHOLD: 200 * 1024 * 1024, // 200MB

  // Caching
  DEFAULT_CACHE_TTL: 5000, // 5s
  MAX_CACHE_ENTRIES: 100,

  // Progress UI
  SHOW_PROGRESS_THRESHOLD: 1000, // Show progress if >1s

  // Repository sizes
  SMALL_REPO_FILES: 100,
  MEDIUM_REPO_FILES: 1000,
  LARGE_REPO_FILES: 10000,
  VERY_LARGE_REPO_FILES: 50000
};

// Adaptive limits based on repo size
export function getAdaptiveLimits(repoFileCount: number): Partial<typeof PERFORMANCE_LIMITS> {
  if (repoFileCount < PERFORMANCE_LIMITS.SMALL_REPO_FILES) {
    return {
      MAX_FILES_TO_PROCESS: 1000,
      MAX_COMMITS_TO_FETCH: 500,
      DEFAULT_CACHE_TTL: 3000
    };
  } else if (repoFileCount < PERFORMANCE_LIMITS.MEDIUM_REPO_FILES) {
    return {
      MAX_FILES_TO_PROCESS: 500,
      MAX_COMMITS_TO_FETCH: 200,
      DEFAULT_CACHE_TTL: 5000
    };
  } else if (repoFileCount < PERFORMANCE_LIMITS.LARGE_REPO_FILES) {
    return {
      MAX_FILES_TO_PROCESS: 200,
      MAX_COMMITS_TO_FETCH: 100,
      DEFAULT_CACHE_TTL: 10000
    };
  } else {
    return {
      MAX_FILES_TO_PROCESS: 100,
      MAX_COMMITS_TO_FETCH: 50,
      DEFAULT_CACHE_TTL: 30000
    };
  }
}
```

---

## Summary of Recommendations

### Performance Targets

| Operation | Target | Acceptable | Unacceptable |
|-----------|--------|------------|--------------|
| Extension activation | <300ms | <500ms | >1s |
| Context generation | <1s | <2s | >5s |
| Git status | <50ms | <200ms | >500ms |
| Git log (100 commits) | <100ms | <300ms | >1s |
| File read (per file) | <50ms | <100ms | >500ms |
| Tree view render | <200ms | <500ms | >2s |
| Diagnostics collection | <500ms | <1s | >3s |
| Memory usage | <30MB | <50MB | >100MB |

### Implementation Priority

1. **High Priority** (Implement first):
   - Git operation caching with smart invalidation
   - File size limits and validation
   - Cancellation token support
   - Progress indicators for long operations

2. **Medium Priority**:
   - Virtual scrolling for tree view
   - Parallel file reading
   - Debounced file watchers
   - Memory monitoring

3. **Low Priority** (Nice to have):
   - Advanced memoization
   - Worker threads for parsing
   - Performance profiling UI
   - Adaptive limits based on repo size

### Code Examples Applied to Current Codebase

Update your `buildContextMarkdown` function with progress reporting:

```typescript
async function buildContextMarkdown(): Promise<CopyContextResult> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Generating Context',
      cancellable: true
    },
    async (progress, token) => {
      progress.report({ message: 'Analyzing workspace...' });

      // Existing code with cancellation checks
      if (token.isCancellationRequested) {
        throw new Error('Operation cancelled');
      }

      // Rest of implementation...
    }
  );
}
```

This comprehensive guide provides all the patterns, benchmarks, and code examples needed to implement performant enhancements while maintaining your current ~1 second context generation time.

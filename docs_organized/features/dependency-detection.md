# Dependency Detection Implementation Guide
**Practical Code Examples for ContextPack-Pro**

---

## Quick Start Implementation

### Step 1: Install Dependencies

```bash
npm install --save @npmcli/package-json pip-requirements-js @iarna/toml fast-xml-parser
```

### Step 2: Create Type Definitions

```typescript
// src/dependency-detection/types.ts

export type Ecosystem =
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'php'
  | 'multi'
  | 'unknown';

export type PackageManager =
  | 'npm'
  | 'yarn'
  | 'pnpm'
  | 'pip'
  | 'poetry'
  | 'cargo'
  | 'go'
  | 'maven'
  | 'gradle'
  | 'nuget'
  | 'bundler'
  | 'composer';

export interface DependencyInfo {
  name: string;
  version: string;
  versionConstraint?: string;
  isDev: boolean;
  category?: string; // 'framework', 'database', 'testing', etc.
}

export interface DependencyDetectionResult {
  ecosystem: Ecosystem;
  packageManager: PackageManager | null;
  manifestFile: string;
  lockFile?: string;
  runtime?: string; // e.g., "Node.js 18+", "Python 3.11+"
  monorepo: boolean;
  workspaceRoot?: string;

  frameworks: Array<{
    name: string;
    version: string;
    type: 'web' | 'api' | 'mobile' | 'desktop' | 'cli';
  }>;

  dependencies: {
    runtime: Record<string, DependencyInfo>;
    development: Record<string, DependencyInfo>;
  };

  buildTools: string[];
  testFrameworks: string[];

  notable: Array<{
    name: string;
    version: string;
    reason: string;
  }>;
}

export interface DetectorOptions {
  includeDevDependencies?: boolean;
  includeLockFiles?: boolean;
  maxFileSize?: number;
  cacheResults?: boolean;
}
```

---

## JavaScript/TypeScript Detector

```typescript
// src/dependency-detection/detectors/javascript.ts

import * as path from 'path';
import * as fs from 'fs/promises';
import { PackageJson } from '@npmcli/package-json';
import type { DependencyDetectionResult, DetectorOptions, DependencyInfo } from '../types';

const MAX_PACKAGE_JSON_SIZE = 5 * 1024 * 1024; // 5MB

export async function detectJavaScript(
  rootPath: string,
  options: DetectorOptions = {}
): Promise<DependencyDetectionResult | null> {
  const packageJsonPath = path.join(rootPath, 'package.json');

  try {
    // Check if file exists and size is reasonable
    const stats = await fs.stat(packageJsonPath);
    if (stats.size > MAX_PACKAGE_JSON_SIZE) {
      console.warn(`package.json too large: ${stats.size} bytes`);
      return null;
    }

    // Parse package.json using npm's official parser
    const pkg = await PackageJson.load(path.dirname(packageJsonPath));
    const content = pkg.content;

    // Detect package manager
    const packageManager = await detectPackageManager(rootPath);

    // Parse dependencies
    const runtimeDeps = parseDependencies(content.dependencies || {}, false);
    const devDeps = parseDependencies(content.devDependencies || {}, true);

    // Detect frameworks
    const frameworks = detectFrameworks(content.dependencies || {}, content.devDependencies || {});

    // Detect build tools
    const buildTools = detectBuildTools(content.dependencies || {}, content.devDependencies || {});

    // Detect test frameworks
    const testFrameworks = detectTestFrameworks(content.devDependencies || {});

    // Detect runtime version
    const runtime = detectRuntime(content.engines);

    // Check for monorepo
    const monorepo = isMonorepo(content);

    // Identify notable packages
    const notable = identifyNotablePackages({ ...runtimeDeps, ...devDeps });

    // Find lock file
    const lockFile = await findLockFile(rootPath, packageManager);

    return {
      ecosystem: 'javascript',
      packageManager,
      manifestFile: packageJsonPath,
      lockFile,
      runtime,
      monorepo,
      frameworks,
      dependencies: {
        runtime: runtimeDeps,
        development: devDeps
      },
      buildTools,
      testFrameworks,
      notable
    };

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // No package.json found
    }
    console.error('Error detecting JavaScript dependencies:', error);
    return null;
  }
}

function parseDependencies(
  deps: Record<string, string>,
  isDev: boolean
): Record<string, DependencyInfo> {
  const result: Record<string, DependencyInfo> = {};

  for (const [name, versionConstraint] of Object.entries(deps)) {
    result[name] = {
      name,
      version: normalizeVersion(versionConstraint),
      versionConstraint,
      isDev,
      category: categorizeDependency(name)
    };
  }

  return result;
}

function normalizeVersion(constraint: string): string {
  // Remove semver operators to get base version
  return constraint.replace(/^[\^~>=<]*/, '').trim();
}

function categorizeDependency(name: string): string {
  const CATEGORIES: Record<string, string[]> = {
    'framework': ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby', 'remix'],
    'state': ['redux', 'zustand', 'mobx', 'recoil', 'jotai', 'valtio'],
    'routing': ['react-router', 'vue-router', 'next/router', '@tanstack/react-router'],
    'styling': ['tailwindcss', 'styled-components', 'emotion', '@mui/material', 'chakra-ui'],
    'data-fetching': ['axios', '@tanstack/react-query', 'swr', 'apollo-client', 'urql'],
    'forms': ['react-hook-form', 'formik', 'yup', 'zod', '@tanstack/react-form'],
    'database': ['prisma', '@prisma/client', 'typeorm', 'sequelize', 'drizzle-orm', 'mongoose'],
    'auth': ['next-auth', 'passport', '@clerk/nextjs', '@supabase/auth-helpers'],
    'testing': ['jest', 'vitest', 'playwright', 'cypress', '@testing-library/react'],
    'build': ['webpack', 'vite', 'rollup', 'parcel', 'esbuild', 'turbo'],
  };

  for (const [category, packages] of Object.entries(CATEGORIES)) {
    if (packages.some(pkg => name === pkg || name.startsWith(`${pkg}/`))) {
      return category;
    }
  }

  return 'utility';
}

function detectFrameworks(
  deps: Record<string, string>,
  devDeps: Record<string, string>
): Array<{ name: string; version: string; type: 'web' | 'api' | 'mobile' | 'desktop' | 'cli' }> {
  const allDeps = { ...deps, ...devDeps };
  const frameworks: Array<{ name: string; version: string; type: 'web' | 'api' | 'mobile' | 'desktop' | 'cli' }> = [];

  // Web frameworks
  if (allDeps['next']) {
    frameworks.push({ name: 'Next.js', version: normalizeVersion(allDeps['next']), type: 'web' });
  } else if (allDeps['react']) {
    frameworks.push({ name: 'React', version: normalizeVersion(allDeps['react']), type: 'web' });
  }

  if (allDeps['vue']) {
    frameworks.push({ name: 'Vue', version: normalizeVersion(allDeps['vue']), type: 'web' });
  }

  if (allDeps['@angular/core']) {
    frameworks.push({ name: 'Angular', version: normalizeVersion(allDeps['@angular/core']), type: 'web' });
  }

  if (allDeps['svelte']) {
    frameworks.push({ name: 'Svelte', version: normalizeVersion(allDeps['svelte']), type: 'web' });
  }

  // API frameworks
  if (allDeps['express']) {
    frameworks.push({ name: 'Express', version: normalizeVersion(allDeps['express']), type: 'api' });
  }

  if (allDeps['@nestjs/core']) {
    frameworks.push({ name: 'NestJS', version: normalizeVersion(allDeps['@nestjs/core']), type: 'api' });
  }

  if (allDeps['fastify']) {
    frameworks.push({ name: 'Fastify', version: normalizeVersion(allDeps['fastify']), type: 'api' });
  }

  // Mobile
  if (allDeps['react-native']) {
    frameworks.push({ name: 'React Native', version: normalizeVersion(allDeps['react-native']), type: 'mobile' });
  }

  return frameworks;
}

function detectBuildTools(
  deps: Record<string, string>,
  devDeps: Record<string, string>
): string[] {
  const allDeps = { ...deps, ...devDeps };
  const tools: string[] = [];

  const BUILD_TOOLS = ['webpack', 'vite', 'rollup', 'parcel', 'esbuild', 'turbo', 'snowpack'];

  for (const tool of BUILD_TOOLS) {
    if (allDeps[tool] || allDeps[`${tool}-cli`]) {
      tools.push(tool);
    }
  }

  return tools;
}

function detectTestFrameworks(devDeps: Record<string, string>): string[] {
  const frameworks: string[] = [];

  const TEST_FRAMEWORKS = ['jest', 'vitest', 'mocha', 'jasmine', 'playwright', 'cypress', 'ava'];

  for (const framework of TEST_FRAMEWORKS) {
    if (devDeps[framework]) {
      frameworks.push(framework);
    }
  }

  return frameworks;
}

function detectRuntime(engines?: Record<string, string>): string | undefined {
  if (!engines) return undefined;

  if (engines.node) {
    return `Node.js ${engines.node}`;
  }

  if (engines.npm) {
    return `npm ${engines.npm}`;
  }

  return undefined;
}

function isMonorepo(packageJson: any): boolean {
  return !!(
    packageJson.workspaces ||
    packageJson.workspaces?.packages
  );
}

function identifyNotablePackages(
  deps: Record<string, DependencyInfo>
): Array<{ name: string; version: string; reason: string }> {
  const notable: Array<{ name: string; version: string; reason: string }> = [];

  const NOTABLE = {
    'react': 'UI library',
    'next': 'React framework',
    'vue': 'UI framework',
    '@angular/core': 'UI framework',
    'typescript': 'Type system',
    'prisma': 'Database ORM',
    '@prisma/client': 'Database client',
    'typeorm': 'Database ORM',
    'mongoose': 'MongoDB ODM',
    '@tanstack/react-query': 'Data fetching',
    'axios': 'HTTP client',
    'tailwindcss': 'CSS framework',
    '@mui/material': 'Component library',
    'redux': 'State management',
    'zustand': 'State management',
    'next-auth': 'Authentication',
    'passport': 'Authentication',
    'zod': 'Validation library',
    'yup': 'Validation library'
  };

  for (const [name, reason] of Object.entries(NOTABLE)) {
    if (deps[name]) {
      notable.push({
        name,
        version: deps[name].version,
        reason
      });
    }
  }

  return notable;
}

async function detectPackageManager(rootPath: string): Promise<'npm' | 'yarn' | 'pnpm' | 'bun'> {
  // Check for lock files to determine package manager
  const lockFiles = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' as const },
    { file: 'yarn.lock', manager: 'yarn' as const },
    { file: 'bun.lockb', manager: 'bun' as const },
    { file: 'package-lock.json', manager: 'npm' as const }
  ];

  for (const { file, manager } of lockFiles) {
    try {
      await fs.access(path.join(rootPath, file));
      return manager;
    } catch {
      // File doesn't exist, continue
    }
  }

  return 'npm'; // Default
}

async function findLockFile(rootPath: string, packageManager: string): Promise<string | undefined> {
  const lockFileMap: Record<string, string> = {
    'npm': 'package-lock.json',
    'yarn': 'yarn.lock',
    'pnpm': 'pnpm-lock.yaml',
    'bun': 'bun.lockb'
  };

  const lockFileName = lockFileMap[packageManager];
  if (!lockFileName) return undefined;

  const lockFilePath = path.join(rootPath, lockFileName);

  try {
    await fs.access(lockFilePath);
    return lockFilePath;
  } catch {
    return undefined;
  }
}
```

---

## Python Detector

```typescript
// src/dependency-detection/detectors/python.ts

import * as path from 'path';
import * as fs from 'fs/promises';
import * as requirementsTxt from 'pip-requirements-js';
import * as TOML from '@iarna/toml';
import type { DependencyDetectionResult, DetectorOptions, DependencyInfo } from '../types';

export async function detectPython(
  rootPath: string,
  options: DetectorOptions = {}
): Promise<DependencyDetectionResult | null> {
  // Try pyproject.toml first (modern)
  const pyprojectPath = path.join(rootPath, 'pyproject.toml');
  if (await fileExists(pyprojectPath)) {
    return await parsePyprojectToml(pyprojectPath, rootPath);
  }

  // Try requirements.txt (classic)
  const requirementsPath = path.join(rootPath, 'requirements.txt');
  if (await fileExists(requirementsPath)) {
    return await parseRequirementsTxt(requirementsPath, rootPath);
  }

  // Try Pipfile (Pipenv)
  const pipfilePath = path.join(rootPath, 'Pipfile');
  if (await fileExists(pipfilePath)) {
    return await parsePipfile(pipfilePath, rootPath);
  }

  return null;
}

async function parsePyprojectToml(
  filePath: string,
  rootPath: string
): Promise<DependencyDetectionResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = TOML.parse(content) as any;

  // Poetry 2.0+ uses [project], Poetry 1.x uses [tool.poetry]
  const projectTable = parsed.project || {};
  const poetryTable = parsed.tool?.poetry || {};

  const deps = projectTable.dependencies || poetryTable.dependencies || {};
  const devDeps = poetryTable['dev-dependencies'] || {};

  const runtimeDeps: Record<string, DependencyInfo> = {};
  const developmentDeps: Record<string, DependencyInfo> = {};

  // Parse runtime dependencies
  for (const [name, constraint] of Object.entries(deps)) {
    if (name === 'python') continue; // Skip Python version requirement

    runtimeDeps[name] = {
      name,
      version: extractVersionFromPythonConstraint(constraint as string),
      versionConstraint: constraint as string,
      isDev: false,
      category: categorizePythonDependency(name)
    };
  }

  // Parse dev dependencies
  for (const [name, constraint] of Object.entries(devDeps)) {
    developmentDeps[name] = {
      name,
      version: extractVersionFromPythonConstraint(constraint as string),
      versionConstraint: constraint as string,
      isDev: true,
      category: categorizePythonDependency(name)
    };
  }

  const allDeps = { ...runtimeDeps, ...developmentDeps };
  const frameworks = detectPythonFrameworks(allDeps);
  const testFrameworks = detectPythonTestFrameworks(developmentDeps);

  // Detect Python version
  const pythonVersion = deps.python || poetryTable.dependencies?.python;
  const runtime = pythonVersion ? `Python ${pythonVersion}` : undefined;

  return {
    ecosystem: 'python',
    packageManager: 'poetry',
    manifestFile: filePath,
    runtime,
    monorepo: false,
    frameworks,
    dependencies: {
      runtime: runtimeDeps,
      development: developmentDeps
    },
    buildTools: [],
    testFrameworks,
    notable: identifyNotablePythonPackages(allDeps)
  };
}

async function parseRequirementsTxt(
  filePath: string,
  rootPath: string
): Promise<DependencyDetectionResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const requirements = requirementsTxt.parse(content);

  const runtimeDeps: Record<string, DependencyInfo> = {};

  for (const req of requirements) {
    if (!req.name) continue;

    runtimeDeps[req.name] = {
      name: req.name,
      version: req.version || '*',
      versionConstraint: req.version || '*',
      isDev: false,
      category: categorizePythonDependency(req.name)
    };
  }

  const frameworks = detectPythonFrameworks(runtimeDeps);

  return {
    ecosystem: 'python',
    packageManager: 'pip',
    manifestFile: filePath,
    runtime: undefined,
    monorepo: false,
    frameworks,
    dependencies: {
      runtime: runtimeDeps,
      development: {}
    },
    buildTools: [],
    testFrameworks: [],
    notable: identifyNotablePythonPackages(runtimeDeps)
  };
}

async function parsePipfile(
  filePath: string,
  rootPath: string
): Promise<DependencyDetectionResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = TOML.parse(content) as any;

  const deps = parsed.packages || {};
  const devDeps = parsed['dev-packages'] || {};

  const runtimeDeps: Record<string, DependencyInfo> = {};
  const developmentDeps: Record<string, DependencyInfo> = {};

  for (const [name, constraint] of Object.entries(deps)) {
    runtimeDeps[name] = {
      name,
      version: extractVersionFromPythonConstraint(constraint as string),
      versionConstraint: constraint as string,
      isDev: false,
      category: categorizePythonDependency(name)
    };
  }

  for (const [name, constraint] of Object.entries(devDeps)) {
    developmentDeps[name] = {
      name,
      version: extractVersionFromPythonConstraint(constraint as string),
      versionConstraint: constraint as string,
      isDev: true,
      category: categorizePythonDependency(name)
    };
  }

  const allDeps = { ...runtimeDeps, ...developmentDeps };
  const frameworks = detectPythonFrameworks(allDeps);
  const testFrameworks = detectPythonTestFrameworks(developmentDeps);

  return {
    ecosystem: 'python',
    packageManager: 'pip',
    manifestFile: filePath,
    runtime: undefined,
    monorepo: false,
    frameworks,
    dependencies: {
      runtime: runtimeDeps,
      development: developmentDeps
    },
    buildTools: [],
    testFrameworks,
    notable: identifyNotablePythonPackages(allDeps)
  };
}

function extractVersionFromPythonConstraint(constraint: string | Record<string, any>): string {
  if (typeof constraint === 'object' && constraint.version) {
    constraint = constraint.version;
  }

  if (typeof constraint !== 'string') return '*';

  // Remove operators: >=, <=, ==, ~=, etc.
  return constraint.replace(/^[><=~^!]+/, '').trim().split(',')[0];
}

function categorizePythonDependency(name: string): string {
  const CATEGORIES: Record<string, string[]> = {
    'framework': ['django', 'flask', 'fastapi', 'tornado', 'bottle', 'pyramid'],
    'database': ['sqlalchemy', 'psycopg2', 'pymongo', 'redis', 'asyncpg'],
    'orm': ['django-orm', 'sqlalchemy', 'peewee', 'tortoise-orm'],
    'testing': ['pytest', 'unittest', 'nose', 'tox', 'coverage'],
    'data': ['pandas', 'numpy', 'scipy', 'matplotlib', 'scikit-learn'],
    'async': ['asyncio', 'aiohttp', 'httpx', 'celery'],
    'validation': ['pydantic', 'marshmallow', 'cerberus']
  };

  const lowerName = name.toLowerCase();

  for (const [category, packages] of Object.entries(CATEGORIES)) {
    if (packages.some(pkg => lowerName.includes(pkg))) {
      return category;
    }
  }

  return 'utility';
}

function detectPythonFrameworks(
  deps: Record<string, DependencyInfo>
): Array<{ name: string; version: string; type: 'web' | 'api' | 'mobile' | 'desktop' | 'cli' }> {
  const frameworks: Array<{ name: string; version: string; type: 'web' | 'api' | 'mobile' | 'desktop' | 'cli' }> = [];

  if (deps['Django'] || deps['django']) {
    const dep = deps['Django'] || deps['django'];
    frameworks.push({ name: 'Django', version: dep.version, type: 'web' });
  }

  if (deps['Flask'] || deps['flask']) {
    const dep = deps['Flask'] || deps['flask'];
    frameworks.push({ name: 'Flask', version: dep.version, type: 'web' });
  }

  if (deps['fastapi']) {
    frameworks.push({ name: 'FastAPI', version: deps['fastapi'].version, type: 'api' });
  }

  return frameworks;
}

function detectPythonTestFrameworks(deps: Record<string, DependencyInfo>): string[] {
  const frameworks: string[] = [];

  if (deps['pytest']) frameworks.push('pytest');
  if (deps['unittest']) frameworks.push('unittest');
  if (deps['nose']) frameworks.push('nose');

  return frameworks;
}

function identifyNotablePythonPackages(
  deps: Record<string, DependencyInfo>
): Array<{ name: string; version: string; reason: string }> {
  const notable: Array<{ name: string; version: string; reason: string }> = [];

  const NOTABLE: Record<string, string> = {
    'Django': 'Web framework',
    'django': 'Web framework',
    'Flask': 'Web framework',
    'flask': 'Web framework',
    'fastapi': 'API framework',
    'sqlalchemy': 'Database ORM',
    'pydantic': 'Data validation',
    'pandas': 'Data analysis',
    'numpy': 'Numerical computing',
    'tensorflow': 'Machine learning',
    'torch': 'Machine learning',
    'celery': 'Task queue'
  };

  for (const [name, reason] of Object.entries(NOTABLE)) {
    if (deps[name]) {
      notable.push({
        name: deps[name].name,
        version: deps[name].version,
        reason
      });
    }
  }

  return notable;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
```

---

## Main Orchestrator

```typescript
// src/dependency-detection/index.ts

import { detectJavaScript } from './detectors/javascript';
import { detectPython } from './detectors/python';
import type { DependencyDetectionResult, DetectorOptions } from './types';

export async function detectAllDependencies(
  rootPath: string,
  options: DetectorOptions = {}
): Promise<DependencyDetectionResult[]> {
  const detectors = [
    detectJavaScript,
    detectPython,
    // Add more detectors as implemented
  ];

  const results = await Promise.allSettled(
    detectors.map(detector => detector(rootPath, options))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<DependencyDetectionResult | null> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value);
}

export { detectJavaScript, detectPython };
export * from './types';
```

---

## Integration with ContextPack-Pro

Add to your existing `buildContextMarkdown` function:

```typescript
// In src/extension.ts

import { detectAllDependencies } from './dependency-detection';

async function buildContextMarkdown(): Promise<CopyContextResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error('No workspace folder is open.');
  }

  const config = vscode.workspace.getConfiguration('copyContext');
  // ... existing config code ...

  // NEW: Detect dependencies
  const dependencyResults = await detectAllDependencies(workspaceFolder.uri.fsPath);
  const dependencyText = formatDependenciesForLLM(dependencyResults);

  // ... existing tree and file collection code ...

  const baseLines = [
    header,
    '',
    // NEW: Add dependency section
    '## Tech Stack',
    dependencyText,
    '',
    structureHeading,
    structureText,
    '',
    `## Files (${files.length})`,
  ];

  // ... rest of existing code ...
}

function formatDependenciesForLLM(results: DependencyDetectionResult[]): string {
  if (results.length === 0) {
    return '_No dependencies detected._';
  }

  let output = '';

  for (const result of results) {
    output += `### ${capitalize(result.ecosystem)}\n`;
    output += `- **Package Manager**: ${result.packageManager}\n`;

    if (result.runtime) {
      output += `- **Runtime**: ${result.runtime}\n`;
    }

    if (result.frameworks.length > 0) {
      const frameworkList = result.frameworks
        .map(f => `${f.name} ${f.version}`)
        .join(', ');
      output += `- **Frameworks**: ${frameworkList}\n`;
    }

    const runtimeDepCount = Object.keys(result.dependencies.runtime).length;
    const devDepCount = Object.keys(result.dependencies.development).length;

    output += `- **Dependencies**: ${runtimeDepCount} runtime, ${devDepCount} development\n`;

    if (result.notable.length > 0) {
      output += '\n**Notable packages**:\n';
      for (const pkg of result.notable) {
        output += `- ${pkg.name}@${pkg.version} - ${pkg.reason}\n`;
      }
    }

    output += '\n';
  }

  return output;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
```

---

## Configuration Options

Add to `package.json` configuration:

```json
{
  "copyContext.includeDependencies": {
    "type": "boolean",
    "default": true,
    "description": "Include dependency detection in project context."
  },
  "copyContext.dependencyDetailLevel": {
    "type": "string",
    "enum": ["minimal", "standard", "detailed"],
    "default": "standard",
    "description": "Level of detail for dependency information."
  },
  "copyContext.includeDevDependencies": {
    "type": "boolean",
    "default": true,
    "description": "Include development dependencies in context."
  }
}
```

---

## Testing

Create test files:

```typescript
// src/dependency-detection/__tests__/javascript.test.ts

import { detectJavaScript } from '../detectors/javascript';
import * as path from 'path';

describe('JavaScript Dependency Detection', () => {
  it('should detect Next.js project', async () => {
    const testDir = path.join(__dirname, 'fixtures', 'nextjs-project');
    const result = await detectJavaScript(testDir);

    expect(result).not.toBeNull();
    expect(result?.ecosystem).toBe('javascript');
    expect(result?.frameworks).toContainEqual({
      name: 'Next.js',
      version: expect.any(String),
      type: 'web'
    });
  });

  it('should detect React project', async () => {
    const testDir = path.join(__dirname, 'fixtures', 'react-project');
    const result = await detectJavaScript(testDir);

    expect(result?.frameworks).toContainEqual({
      name: 'React',
      version: expect.any(String),
      type: 'web'
    });
  });

  it('should return null for non-JS projects', async () => {
    const testDir = path.join(__dirname, 'fixtures', 'python-project');
    const result = await detectJavaScript(testDir);

    expect(result).toBeNull();
  });
});
```

---

## Performance Monitoring

Add performance tracking:

```typescript
// src/dependency-detection/performance.ts

export class PerformanceMonitor {
  private timings = new Map<string, number>();

  start(label: string): void {
    this.timings.set(label, Date.now());
  }

  end(label: string): number {
    const start = this.timings.get(label);
    if (!start) return 0;

    const duration = Date.now() - start;
    console.log(`[Perf] ${label}: ${duration}ms`);
    this.timings.delete(label);
    return duration;
  }

  async measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.start(label);
    try {
      return await fn();
    } finally {
      this.end(label);
    }
  }
}

// Usage:
const perf = new PerformanceMonitor();
const result = await perf.measure('detectJavaScript', () => detectJavaScript(rootPath));
```

---

## Error Boundaries

Add comprehensive error handling:

```typescript
// src/dependency-detection/errors.ts

export class DependencyDetectionError extends Error {
  constructor(
    message: string,
    public readonly ecosystem: string,
    public readonly filePath: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'DependencyDetectionError';
  }
}

export function handleDetectionError(error: unknown, context: string): null {
  if (error instanceof DependencyDetectionError) {
    console.error(
      `[DependencyDetection] ${context}: ${error.message}`,
      { ecosystem: error.ecosystem, file: error.filePath }
    );
  } else if (error instanceof Error) {
    console.error(`[DependencyDetection] ${context}: ${error.message}`);
  } else {
    console.error(`[DependencyDetection] ${context}: Unknown error`, error);
  }

  return null;
}
```

---

## Next Steps

1. **Implement additional detectors**:
   - Rust (Cargo.toml)
   - Go (go.mod)
   - Java (pom.xml, build.gradle)

2. **Add caching layer**:
   - Use VS Code's `ExtensionContext.workspaceState` for persistence
   - Cache key: `${gitHash}:${manifestPath}`

3. **Add configuration UI**:
   - Allow users to enable/disable specific ecosystems
   - Configure detail level (minimal/standard/detailed)

4. **Test with real projects**:
   - Clone popular open-source projects
   - Verify detection accuracy
   - Measure performance

5. **Gather user feedback**:
   - Are the detected frameworks correct?
   - Is the LLM context useful?
   - What's missing?

---

**Last Updated**: January 2025

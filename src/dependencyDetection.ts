import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PackageJson } from '@npmcli/package-json';

export type Ecosystem =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'php'
  | 'multi'
  | 'unknown';

export type FrameworkType = 'web' | 'api' | 'mobile' | 'desktop' | 'cli';

export interface Framework {
  name: string;
  version: string;
  type: FrameworkType;
}

export interface DependencyInfo {
  name: string;
  version: string;
  isDev: boolean;
  category: string;
}

export interface TechStackInfo {
  ecosystem: Ecosystem;
  frameworks: Framework[];
  runtime?: string;
  buildTools: string[];
  testFrameworks: string[];
  databases: string[];
  notable: Array<{ name: string; version: string; reason: string }>;
  dependencies: {
    runtime: Record<string, DependencyInfo>;
    development: Record<string, DependencyInfo>;
  };
}

export class DependencyDetector {
  private cache: Map<string, TechStackInfo> = new Map();
  private readonly CACHE_TTL = 30000; // 30 seconds

  constructor() {}

  /**
   * Detect tech stack for workspace
   */
  async detectTechStack(): Promise<TechStackInfo | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    const rootPath = workspaceFolder.uri.fsPath;
    const cacheKey = rootPath;
    const cached = this.cache.get(cacheKey);

    if (cached) {
      return cached;
    }

    // Try different ecosystems
    const detectors = [
      () => this.detectJavaScript(rootPath),
      () => this.detectPython(rootPath),
      () => this.detectRust(rootPath),
      () => this.detectGo(rootPath),
    ];

    for (const detector of detectors) {
      const result = await detector();
      if (result) {
        this.cache.set(cacheKey, result);
        setTimeout(() => this.cache.delete(cacheKey), this.CACHE_TTL);
        return result;
      }
    }

    return null;
  }

  /**
   * Detect JavaScript/TypeScript project
   */
  private async detectJavaScript(rootPath: string): Promise<TechStackInfo | null> {
    const packageJsonPath = path.join(rootPath, 'package.json');

    try {
      const stats = await fs.stat(packageJsonPath);
      if (stats.size > 5 * 1024 * 1024) {
        return null; // Too large
      }

      const pkg = await PackageJson.load(path.dirname(packageJsonPath));
      const content = pkg.content;

      const dependencies = content.dependencies || {};
      const devDependencies = content.devDependencies || {};
      const allDeps = { ...dependencies, ...devDependencies };

      // Detect frameworks
      const frameworks = this.detectJSFrameworks(dependencies, devDependencies);

      // Detect build tools
      const buildTools = this.detectBuildTools(allDeps);

      // Detect test frameworks
      const testFrameworks = this.detectTestFrameworks(devDependencies);

      // Detect databases
      const databases = this.detectDatabases(dependencies);

      // Parse dependencies
      const runtimeDeps = this.parseDependencies(dependencies, false);
      const devDeps = this.parseDependencies(devDependencies, true);

      // Detect runtime
      const runtime = this.detectRuntime(content.engines);

      // Identify notable packages
      const notable = this.identifyNotablePackages({ ...runtimeDeps, ...devDeps });

      // Determine if TypeScript
      const ecosystem: Ecosystem =
        devDeps['typescript'] || allDeps['typescript'] ? 'typescript' : 'javascript';

      return {
        ecosystem,
        frameworks,
        runtime,
        buildTools,
        testFrameworks,
        databases,
        notable,
        dependencies: {
          runtime: runtimeDeps,
          development: devDeps
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Detect Python project
   */
  private async detectPython(rootPath: string): Promise<TechStackInfo | null> {
    const requirementsPath = path.join(rootPath, 'requirements.txt');
    const pyprojectPath = path.join(rootPath, 'pyproject.toml');

    try {
      // Check for requirements.txt
      await fs.stat(requirementsPath);

      const content = await fs.readFile(requirementsPath, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));

      const frameworks: Framework[] = [];
      const dependencies: Record<string, DependencyInfo> = {};

      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)(==|>=|<=|>|<)?(.+)?/);
        if (match) {
          const name = match[1];
          const version = match[3] || 'latest';

          dependencies[name] = {
            name,
            version,
            isDev: false,
            category: this.categorizePythonPackage(name)
          };

          // Detect frameworks
          if (name === 'django') {
            frameworks.push({ name: 'Django', version, type: 'web' });
          } else if (name === 'flask') {
            frameworks.push({ name: 'Flask', version, type: 'web' });
          } else if (name === 'fastapi') {
            frameworks.push({ name: 'FastAPI', version, type: 'api' });
          }
        }
      }

      return {
        ecosystem: 'python',
        frameworks,
        runtime: 'Python 3.x',
        buildTools: [],
        testFrameworks: this.detectPythonTestFrameworks(dependencies),
        databases: this.detectPythonDatabases(dependencies),
        notable: [],
        dependencies: {
          runtime: dependencies,
          development: {}
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Detect Rust project
   */
  private async detectRust(rootPath: string): Promise<TechStackInfo | null> {
    const cargoPath = path.join(rootPath, 'Cargo.toml');

    try {
      await fs.stat(cargoPath);

      return {
        ecosystem: 'rust',
        frameworks: [],
        runtime: 'Rust',
        buildTools: ['cargo'],
        testFrameworks: ['built-in'],
        databases: [],
        notable: [],
        dependencies: {
          runtime: {},
          development: {}
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Detect Go project
   */
  private async detectGo(rootPath: string): Promise<TechStackInfo | null> {
    const goModPath = path.join(rootPath, 'go.mod');

    try {
      await fs.stat(goModPath);

      return {
        ecosystem: 'go',
        frameworks: [],
        runtime: 'Go',
        buildTools: ['go'],
        testFrameworks: ['built-in'],
        databases: [],
        notable: [],
        dependencies: {
          runtime: {},
          development: {}
        }
      };
    } catch (error) {
      return null;
    }
  }

  private detectJSFrameworks(deps: Record<string, string>, devDeps: Record<string, string>): Framework[] {
    const allDeps = { ...deps, ...devDeps };
    const frameworks: Framework[] = [];

    // Web frameworks
    if (allDeps['next']) {
      frameworks.push({ name: 'Next.js', version: this.normalizeVersion(allDeps['next']), type: 'web' });
    } else if (allDeps['react']) {
      frameworks.push({ name: 'React', version: this.normalizeVersion(allDeps['react']), type: 'web' });
    }

    if (allDeps['vue']) {
      frameworks.push({ name: 'Vue', version: this.normalizeVersion(allDeps['vue']), type: 'web' });
    }

    if (allDeps['@angular/core']) {
      frameworks.push({ name: 'Angular', version: this.normalizeVersion(allDeps['@angular/core']), type: 'web' });
    }

    if (allDeps['svelte']) {
      frameworks.push({ name: 'Svelte', version: this.normalizeVersion(allDeps['svelte']), type: 'web' });
    }

    // API frameworks
    if (allDeps['express']) {
      frameworks.push({ name: 'Express', version: this.normalizeVersion(allDeps['express']), type: 'api' });
    }

    if (allDeps['@nestjs/core']) {
      frameworks.push({ name: 'NestJS', version: this.normalizeVersion(allDeps['@nestjs/core']), type: 'api' });
    }

    if (allDeps['fastify']) {
      frameworks.push({ name: 'Fastify', version: this.normalizeVersion(allDeps['fastify']), type: 'api' });
    }

    // Mobile
    if (allDeps['react-native']) {
      frameworks.push({ name: 'React Native', version: this.normalizeVersion(allDeps['react-native']), type: 'mobile' });
    }

    return frameworks;
  }

  private detectBuildTools(deps: Record<string, string>): string[] {
    const tools: string[] = [];
    const BUILD_TOOLS = ['webpack', 'vite', 'rollup', 'parcel', 'esbuild', 'turbo', 'snowpack'];

    for (const tool of BUILD_TOOLS) {
      if (deps[tool]) {
        tools.push(tool);
      }
    }

    return tools;
  }

  private detectTestFrameworks(devDeps: Record<string, string>): string[] {
    const frameworks: string[] = [];
    const TEST_FRAMEWORKS = ['jest', 'vitest', 'mocha', 'jasmine', 'playwright', 'cypress', 'ava'];

    for (const framework of TEST_FRAMEWORKS) {
      if (devDeps[framework]) {
        frameworks.push(framework);
      }
    }

    return frameworks;
  }

  private detectDatabases(deps: Record<string, string>): string[] {
    const databases: string[] = [];
    const DB_PACKAGES: Record<string, string> = {
      'prisma': 'Prisma',
      '@prisma/client': 'Prisma',
      'typeorm': 'TypeORM',
      'sequelize': 'Sequelize',
      'mongoose': 'MongoDB',
      'pg': 'PostgreSQL',
      'mysql2': 'MySQL',
      'sqlite3': 'SQLite',
      'redis': 'Redis'
    };

    for (const [pkg, db] of Object.entries(DB_PACKAGES)) {
      if (deps[pkg] && !databases.includes(db)) {
        databases.push(db);
      }
    }

    return databases;
  }

  private detectPythonTestFrameworks(deps: Record<string, DependencyInfo>): string[] {
    const frameworks: string[] = [];
    if (deps['pytest']) frameworks.push('pytest');
    if (deps['unittest']) frameworks.push('unittest');
    return frameworks;
  }

  private detectPythonDatabases(deps: Record<string, DependencyInfo>): string[] {
    const databases: string[] = [];
    if (deps['psycopg2'] || deps['psycopg2-binary']) databases.push('PostgreSQL');
    if (deps['pymongo']) databases.push('MongoDB');
    if (deps['redis']) databases.push('Redis');
    if (deps['sqlalchemy']) databases.push('SQLAlchemy');
    return databases;
  }

  private parseDependencies(deps: Record<string, string>, isDev: boolean): Record<string, DependencyInfo> {
    const result: Record<string, DependencyInfo> = {};

    for (const [name, versionConstraint] of Object.entries(deps)) {
      result[name] = {
        name,
        version: this.normalizeVersion(versionConstraint),
        isDev,
        category: this.categorizeDependency(name)
      };
    }

    return result;
  }

  private normalizeVersion(constraint: string): string {
    return constraint.replace(/^[\^~>=<]*/, '').trim();
  }

  private categorizeDependency(name: string): string {
    const CATEGORIES: Record<string, string[]> = {
      'framework': ['react', 'vue', 'angular', 'svelte', 'next', 'nuxt'],
      'state': ['redux', 'zustand', 'mobx', 'recoil'],
      'styling': ['tailwindcss', 'styled-components', 'emotion'],
      'data-fetching': ['axios', '@tanstack/react-query', 'swr'],
      'forms': ['react-hook-form', 'formik', 'yup', 'zod'],
      'database': ['prisma', 'typeorm', 'sequelize', 'mongoose'],
      'testing': ['jest', 'vitest', 'playwright', 'cypress'],
      'build': ['webpack', 'vite', 'rollup', 'esbuild'],
    };

    for (const [category, packages] of Object.entries(CATEGORIES)) {
      if (packages.some(pkg => name === pkg || name.startsWith(`${pkg}/`))) {
        return category;
      }
    }

    return 'utility';
  }

  private categorizePythonPackage(name: string): string {
    const CATEGORIES: Record<string, string[]> = {
      'framework': ['django', 'flask', 'fastapi'],
      'database': ['sqlalchemy', 'psycopg2', 'pymongo'],
      'testing': ['pytest', 'unittest'],
    };

    for (const [category, packages] of Object.entries(CATEGORIES)) {
      if (packages.includes(name)) {
        return category;
      }
    }

    return 'utility';
  }

  private detectRuntime(engines: any): string | undefined {
    if (engines?.node) {
      return `Node.js ${engines.node}`;
    }
    return undefined;
  }

  private identifyNotablePackages(deps: Record<string, DependencyInfo>): Array<{ name: string; version: string; reason: string }> {
    const notable: Array<{ name: string; version: string; reason: string }> = [];

    const NOTABLE: Record<string, string> = {
      'react': 'Popular UI library',
      'next': 'React framework for production',
      'typescript': 'Type-safe JavaScript',
      'tailwindcss': 'Utility-first CSS framework',
      'prisma': 'Modern database toolkit',
      '@tanstack/react-query': 'Powerful data fetching',
      'zod': 'TypeScript-first schema validation',
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

  /**
   * Format tech stack for display
   */
  formatTechStack(techStack: TechStackInfo): string {
    let output = '# Tech Stack\n\n';

    output += `**Ecosystem**: ${techStack.ecosystem}\n\n`;

    if (techStack.runtime) {
      output += `**Runtime**: ${techStack.runtime}\n\n`;
    }

    if (techStack.frameworks.length > 0) {
      output += '## Frameworks\n\n';
      for (const framework of techStack.frameworks) {
        output += `- **${framework.name}** v${framework.version} (${framework.type})\n`;
      }
      output += '\n';
    }

    if (techStack.buildTools.length > 0) {
      output += `**Build Tools**: ${techStack.buildTools.join(', ')}\n\n`;
    }

    if (techStack.testFrameworks.length > 0) {
      output += `**Test Frameworks**: ${techStack.testFrameworks.join(', ')}\n\n`;
    }

    if (techStack.databases.length > 0) {
      output += `**Databases**: ${techStack.databases.join(', ')}\n\n`;
    }

    if (techStack.notable.length > 0) {
      output += '## Notable Dependencies\n\n';
      for (const pkg of techStack.notable) {
        output += `- **${pkg.name}** v${pkg.version} - ${pkg.reason}\n`;
      }
      output += '\n';
    }

    return output;
  }

  dispose(): void {
    this.cache.clear();
  }
}

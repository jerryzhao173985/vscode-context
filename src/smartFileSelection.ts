import * as vscode from 'vscode';
import { FileRelationshipAnalyzer, RelationshipType } from './fileRelationships';

export interface FileScore {
  uri: vscode.Uri;
  score: number;
  reasons: string[];
}

export interface FileGraph {
  nodes: Map<string, FileNode>;
  edges: Map<string, Set<string>>;
}

export interface FileNode {
  uri: vscode.Uri;
  rank: number;
  lastAccessed?: number;
  accessCount?: number;
}

export class SmartFileSelector {
  private relationshipAnalyzer: FileRelationshipAnalyzer;
  private fileGraph: FileGraph = {
    nodes: new Map(),
    edges: new Map()
  };

  constructor(relationshipAnalyzer: FileRelationshipAnalyzer) {
    this.relationshipAnalyzer = relationshipAnalyzer;
  }

  /**
   * Score and rank files based on multiple factors
   */
  async scoreFiles(
    candidates: vscode.Uri[],
    context: {
      selectedFiles?: vscode.Uri[];
      openEditors?: vscode.Uri[];
      modifiedFiles?: vscode.Uri[];
      errorFiles?: vscode.Uri[];
    }
  ): Promise<FileScore[]> {
    const scores: FileScore[] = [];

    for (const uri of candidates) {
      const score = await this.calculateFileScore(uri, context);
      scores.push(score);
    }

    // Sort by score (highest first)
    scores.sort((a, b) => b.score - a.score);

    return scores;
  }

  /**
   * Calculate comprehensive score for a file
   */
  private async calculateFileScore(
    uri: vscode.Uri,
    context: {
      selectedFiles?: vscode.Uri[];
      openEditors?: vscode.Uri[];
      modifiedFiles?: vscode.Uri[];
      errorFiles?: vscode.Uri[];
    }
  ): Promise<FileScore> {
    const reasons: string[] = [];
    let score = 0;

    // Base score
    score += 10;

    // Currently selected files get highest priority
    if (context.selectedFiles?.some(f => f.fsPath === uri.fsPath)) {
      score += 100;
      reasons.push('Already selected');
    }

    // Open editors get high priority
    if (context.openEditors?.some(f => f.fsPath === uri.fsPath)) {
      score += 50;
      reasons.push('Currently open');
    }

    // Modified files get high priority (Git-aware)
    if (context.modifiedFiles?.some(f => f.fsPath === uri.fsPath)) {
      score += 40;
      reasons.push('Modified (Git)');
    }

    // Files with errors get priority
    if (context.errorFiles?.some(f => f.fsPath === uri.fsPath)) {
      score += 45;
      reasons.push('Has errors');
    }

    // Relationship-based scoring
    if (context.selectedFiles && context.selectedFiles.length > 0) {
      const relationshipScore = await this.calculateRelationshipScore(uri, context.selectedFiles);
      score += relationshipScore.score;
      reasons.push(...relationshipScore.reasons);
    }

    // Frecency-based scoring (frequency + recency)
    const frecencyScore = this.calculateFrecencyScore(uri);
    score += frecencyScore.score;
    if (frecencyScore.reason) {
      reasons.push(frecencyScore.reason);
    }

    // File type scoring
    const typeScore = this.calculateTypeScore(uri);
    score += typeScore.score;
    if (typeScore.reason) {
      reasons.push(typeScore.reason);
    }

    return {
      uri,
      score,
      reasons
    };
  }

  /**
   * Calculate score based on relationships to selected files
   */
  private async calculateRelationshipScore(
    uri: vscode.Uri,
    selectedFiles: vscode.Uri[]
  ): Promise<{ score: number; reasons: string[] }> {
    let score = 0;
    const reasons: string[] = [];

    for (const selectedFile of selectedFiles) {
      const relationships = await this.relationshipAnalyzer.findRelatedFiles(
        selectedFile,
        {
          types: ['imports', 'tests', 'types', 'used-by'],
          maxFiles: 50,
          confidenceThreshold: 0.5
        }
      );

      for (const rel of relationships) {
        if (rel.file.fsPath === uri.fsPath) {
          const relationshipScores: Record<RelationshipType, number> = {
            'imports': 30,
            'tests': 25,
            'types': 20,
            'used-by': 15
          };

          const baseScore = relationshipScores[rel.type] || 10;
          const confidenceBonus = rel.confidence * 10;
          const relationshipScore = baseScore + confidenceBonus;

          score += relationshipScore;
          reasons.push(`${rel.type} (${(rel.confidence * 100).toFixed(0)}% confidence)`);
        }
      }
    }

    return { score, reasons };
  }

  /**
   * Calculate frecency score (frequency + recency)
   */
  private calculateFrecencyScore(uri: vscode.Uri): { score: number; reason?: string } {
    const node = this.fileGraph.nodes.get(uri.fsPath);

    if (!node || !node.lastAccessed || !node.accessCount) {
      return { score: 0 };
    }

    // Recency score (exponential decay)
    const now = Date.now();
    const timeSinceAccess = now - node.lastAccessed;
    const daysSinceAccess = timeSinceAccess / (1000 * 60 * 60 * 24);

    // Score decreases exponentially with time
    const recencyScore = Math.exp(-daysSinceAccess / 7) * 20; // Half-life of 7 days

    // Frequency score
    const frequencyScore = Math.min(node.accessCount * 2, 20);

    const totalScore = recencyScore + frequencyScore;

    let reason: string | undefined;
    if (totalScore > 10) {
      reason = `Frequently accessed (${node.accessCount} times)`;
    }

    return {
      score: totalScore,
      reason
    };
  }

  /**
   * Calculate score based on file type
   */
  private calculateTypeScore(uri: vscode.Uri): { score: number; reason?: string } {
    const ext = uri.fsPath.split('.').pop()?.toLowerCase();

    const typeScores: Record<string, number> = {
      // Source files
      'ts': 15,
      'tsx': 15,
      'js': 12,
      'jsx': 12,
      'py': 15,
      'java': 12,
      'go': 12,
      'rs': 12,
      'c': 10,
      'cpp': 10,
      'h': 8,
      'hpp': 8,

      // Test files
      'test.ts': 10,
      'test.js': 10,
      'spec.ts': 10,
      'spec.js': 10,

      // Config files
      'json': 5,
      'yaml': 5,
      'yml': 5,
      'toml': 5,

      // Documentation
      'md': 3,
      'txt': 2,
    };

    const score = typeScores[ext || ''] || 0;
    const reason = score > 10 ? 'Source file' : undefined;

    return { score, reason };
  }

  /**
   * Record file access for frecency tracking
   */
  recordFileAccess(uri: vscode.Uri): void {
    const fsPath = uri.fsPath;
    let node = this.fileGraph.nodes.get(fsPath);

    if (!node) {
      node = {
        uri,
        rank: 0,
        lastAccessed: Date.now(),
        accessCount: 1
      };
      this.fileGraph.nodes.set(fsPath, node);
    } else {
      node.lastAccessed = Date.now();
      node.accessCount = (node.accessCount || 0) + 1;
    }
  }

  /**
   * Build file dependency graph using PageRank-style algorithm
   */
  async buildDependencyGraph(files: vscode.Uri[]): Promise<void> {
    // Clear existing graph
    this.fileGraph.nodes.clear();
    this.fileGraph.edges.clear();

    // Initialize nodes
    for (const uri of files) {
      this.fileGraph.nodes.set(uri.fsPath, {
        uri,
        rank: 1.0 / files.length // Initial uniform distribution
      });
    }

    // Build edges based on relationships
    for (const uri of files) {
      const relationships = await this.relationshipAnalyzer.findRelatedFiles(
        uri,
        {
          types: ['imports', 'used-by'],
          maxFiles: 100,
          confidenceThreshold: 0.6
        }
      );

      const edges = new Set<string>();
      for (const rel of relationships) {
        if (this.fileGraph.nodes.has(rel.file.fsPath)) {
          edges.add(rel.file.fsPath);
        }
      }

      this.fileGraph.edges.set(uri.fsPath, edges);
    }

    // Run PageRank algorithm
    await this.calculatePageRank();
  }

  /**
   * Calculate PageRank scores
   */
  private async calculatePageRank(iterations: number = 10, dampingFactor: number = 0.85): Promise<void> {
    const n = this.fileGraph.nodes.size;
    if (n === 0) return;

    for (let i = 0; i < iterations; i++) {
      const newRanks = new Map<string, number>();

      for (const [nodePath, node] of this.fileGraph.nodes) {
        let rank = (1 - dampingFactor) / n;

        // Sum contributions from incoming edges
        for (const [sourcePath, edges] of this.fileGraph.edges) {
          if (edges.has(nodePath)) {
            const sourceNode = this.fileGraph.nodes.get(sourcePath);
            if (sourceNode) {
              const outDegree = edges.size;
              rank += dampingFactor * (sourceNode.rank / outDegree);
            }
          }
        }

        newRanks.set(nodePath, rank);
      }

      // Update ranks
      for (const [path, rank] of newRanks) {
        const node = this.fileGraph.nodes.get(path);
        if (node) {
          node.rank = rank;
        }
      }
    }
  }

  /**
   * Get top-ranked files
   */
  getTopRankedFiles(limit: number = 10): vscode.Uri[] {
    const nodes = Array.from(this.fileGraph.nodes.values());
    nodes.sort((a, b) => b.rank - a.rank);

    return nodes.slice(0, limit).map(node => node.uri);
  }

  /**
   * Get suggested files based on current selection
   */
  async getSuggestedFiles(
    currentSelection: vscode.Uri[],
    context: {
      openEditors?: vscode.Uri[];
      modifiedFiles?: vscode.Uri[];
      errorFiles?: vscode.Uri[];
    },
    limit: number = 10
  ): Promise<FileScore[]> {
    // Get all potential candidates
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const candidates = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,java,go,rs,c,cpp}',
      '**/node_modules/**'
    );

    // Filter out already selected files
    const selectedPaths = new Set(currentSelection.map(uri => uri.fsPath));
    const unselectedCandidates = candidates.filter(uri => !selectedPaths.has(uri.fsPath));

    // Score all candidates
    const scores = await this.scoreFiles(unselectedCandidates, {
      selectedFiles: currentSelection,
      ...context
    });

    return scores.slice(0, limit);
  }

  /**
   * Format suggestions for display
   */
  formatSuggestions(suggestions: FileScore[]): string {
    if (suggestions.length === 0) {
      return 'No suggestions available.';
    }

    let output = '# Suggested Files\n\n';

    for (const suggestion of suggestions) {
      const relativePath = vscode.workspace.asRelativePath(suggestion.uri);
      output += `## ${relativePath} (Score: ${suggestion.score.toFixed(1)})\n\n`;

      if (suggestion.reasons.length > 0) {
        output += '**Reasons:**\n';
        for (const reason of suggestion.reasons) {
          output += `- ${reason}\n`;
        }
      }

      output += '\n';
    }

    return output;
  }

  dispose(): void {
    this.fileGraph.nodes.clear();
    this.fileGraph.edges.clear();
  }
}

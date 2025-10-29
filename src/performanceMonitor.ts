import * as vscode from 'vscode';

export interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface PerformanceStats {
  operation: string;
  count: number;
  totalDuration: number;
  averageDuration: number;
  minDuration: number;
  maxDuration: number;
  lastDuration: number;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private activeTimers: Map<string, number> = new Map();
  private maxMetrics = 1000; // Keep last 1000 metrics
  private enabled: boolean;

  constructor() {
    const config = vscode.workspace.getConfiguration('copyContext');
    this.enabled = config.get<boolean>('enablePerformanceMonitoring', false);
  }

  /**
   * Start timing an operation
   */
  start(operation: string): void {
    if (!this.enabled) return;
    this.activeTimers.set(operation, performance.now());
  }

  /**
   * End timing an operation
   */
  end(operation: string, metadata?: Record<string, any>): void {
    if (!this.enabled) return;

    const startTime = this.activeTimers.get(operation);
    if (!startTime) return;

    const duration = performance.now() - startTime;
    this.activeTimers.delete(operation);

    this.recordMetric({
      operation,
      duration,
      timestamp: Date.now(),
      metadata
    });
  }

  /**
   * Record a metric
   */
  private recordMetric(metric: PerformanceMetric): void {
    this.metrics.push(metric);

    // Trim old metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    // Log slow operations
    if (metric.duration > 2000) {
      console.warn(`Slow operation detected: ${metric.operation} took ${metric.duration.toFixed(2)}ms`);
    }
  }

  /**
   * Get statistics for an operation
   */
  getStats(operation: string): PerformanceStats | null {
    const operationMetrics = this.metrics.filter(m => m.operation === operation);

    if (operationMetrics.length === 0) {
      return null;
    }

    const durations = operationMetrics.map(m => m.duration);
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);

    return {
      operation,
      count: operationMetrics.length,
      totalDuration,
      averageDuration: totalDuration / operationMetrics.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastDuration: operationMetrics[operationMetrics.length - 1].duration
    };
  }

  /**
   * Get all statistics
   */
  getAllStats(): PerformanceStats[] {
    const operations = new Set(this.metrics.map(m => m.operation));
    const stats: PerformanceStats[] = [];

    for (const operation of operations) {
      const stat = this.getStats(operation);
      if (stat) {
        stats.push(stat);
      }
    }

    return stats.sort((a, b) => b.averageDuration - a.averageDuration);
  }

  /**
   * Format statistics for display
   */
  formatStats(): string {
    if (!this.enabled) {
      return 'Performance monitoring is disabled. Enable it in settings: copyContext.enablePerformanceMonitoring';
    }

    const stats = this.getAllStats();

    if (stats.length === 0) {
      return 'No performance data collected yet.';
    }

    let output = '# Performance Statistics\n\n';
    output += `**Total Operations**: ${this.metrics.length}\n`;
    output += `**Unique Operations**: ${stats.length}\n\n`;

    output += '## Operations (sorted by average duration)\n\n';
    output += '| Operation | Count | Avg (ms) | Min (ms) | Max (ms) | Last (ms) |\n';
    output += '|-----------|-------|----------|----------|----------|----------|\n';

    for (const stat of stats) {
      output += `| ${stat.operation} | ${stat.count} | ${stat.averageDuration.toFixed(2)} | ${stat.minDuration.toFixed(2)} | ${stat.maxDuration.toFixed(2)} | ${stat.lastDuration.toFixed(2)} |\n`;
    }

    output += '\n## Slow Operations (>2s)\n\n';

    const slowOps = this.metrics.filter(m => m.duration > 2000);
    if (slowOps.length === 0) {
      output += 'No slow operations detected.\n';
    } else {
      for (const metric of slowOps.slice(-10)) {
        const date = new Date(metric.timestamp).toISOString();
        output += `- **${metric.operation}**: ${metric.duration.toFixed(2)}ms at ${date}\n`;
        if (metric.metadata) {
          output += `  - Metadata: ${JSON.stringify(metric.metadata)}\n`;
        }
      }
    }

    return output;
  }

  /**
   * Get performance report
   */
  getReport(): {
    isHealthy: boolean;
    issues: string[];
    recommendations: string[];
  } {
    const stats = this.getAllStats();
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for slow operations
    const slowOps = stats.filter(s => s.averageDuration > 1000);
    if (slowOps.length > 0) {
      issues.push(`${slowOps.length} operations averaging >1s`);
      recommendations.push('Consider optimizing slow operations or increasing cache TTL');
    }

    // Check for frequently called operations
    const frequentOps = stats.filter(s => s.count > 100);
    if (frequentOps.length > 0) {
      issues.push(`${frequentOps.length} operations called >100 times`);
      recommendations.push('Consider caching results for frequently called operations');
    }

    // Check for high max durations
    const spikyOps = stats.filter(s => s.maxDuration > s.averageDuration * 5);
    if (spikyOps.length > 0) {
      issues.push(`${spikyOps.length} operations with high variance`);
      recommendations.push('Investigate operations with inconsistent performance');
    }

    return {
      isHealthy: issues.length === 0,
      issues,
      recommendations
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
    this.activeTimers.clear();
  }

  /**
   * Enable/disable monitoring
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  /**
   * Get recent metrics
   */
  getRecentMetrics(count: number = 10): PerformanceMetric[] {
    return this.metrics.slice(-count);
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * Decorator for automatic performance monitoring
 */
export function monitor(operation: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const monitor = new PerformanceMonitor();
      monitor.start(operation || propertyKey);

      try {
        const result = await originalMethod.apply(this, args);
        monitor.end(operation || propertyKey);
        return result;
      } catch (error) {
        monitor.end(operation || propertyKey, { error: String(error) });
        throw error;
      }
    };

    return descriptor;
  };
}

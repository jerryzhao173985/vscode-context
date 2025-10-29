import { Tiktoken } from 'js-tiktoken/lite';
import cl100k_base from 'js-tiktoken/ranks/cl100k_base';

/**
 * Model pricing information (per million tokens)
 * Updated as of October 2025
 */
interface ModelPricing {
  name: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': {
    name: 'GPT-4o',
    inputCostPerMillion: 2.50,
    outputCostPerMillion: 10.00
  },
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.60
  },
  'gpt-4-turbo': {
    name: 'GPT-4 Turbo',
    inputCostPerMillion: 10.00,
    outputCostPerMillion: 30.00
  },
  'gpt-3.5-turbo': {
    name: 'GPT-3.5 Turbo',
    inputCostPerMillion: 0.50,
    outputCostPerMillion: 1.50
  },
  'claude-3.5-sonnet': {
    name: 'Claude 3.5 Sonnet',
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00
  },
  'claude-3-opus': {
    name: 'Claude 3 Opus',
    inputCostPerMillion: 15.00,
    outputCostPerMillion: 75.00
  },
  'claude-3-haiku': {
    name: 'Claude 3 Haiku',
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 1.25
  }
};

export interface TokenCount {
  tokens: number;
  characters: number;
  estimatedCost: Record<string, number>;
}

export class TokenCounter {
  private encoding: Tiktoken;

  constructor() {
    // Initialize with cl100k_base encoding (used by GPT-4, GPT-3.5-turbo, Claude 3+)
    this.encoding = new Tiktoken(cl100k_base);
  }

  /**
   * Count tokens in text using tiktoken
   */
  countTokens(text: string): number {
    try {
      const tokens = this.encoding.encode(text);
      return tokens.length;
    } catch (error) {
      console.error('Error counting tokens:', error);
      // Fallback to character-based estimation (roughly 4 chars per token)
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Get detailed token count with cost estimates
   */
  getTokenCount(text: string, models?: string[]): TokenCount {
    const tokens = this.countTokens(text);
    const characters = text.length;

    // Use configured models or default popular ones
    const modelsToEstimate = models || ['gpt-4o', 'claude-3.5-sonnet', 'gpt-4o-mini'];

    const estimatedCost: Record<string, number> = {};
    for (const modelKey of modelsToEstimate) {
      const pricing = MODEL_PRICING[modelKey];
      if (pricing) {
        // Calculate input cost (assuming this is input context)
        estimatedCost[pricing.name] = (tokens / 1000000) * pricing.inputCostPerMillion;
      }
    }

    return {
      tokens,
      characters,
      estimatedCost
    };
  }

  /**
   * Format token count for display
   */
  formatTokenCount(count: TokenCount): string {
    let output = `📊 **Token Count**\n\n`;
    output += `- Tokens: ${count.tokens.toLocaleString()}\n`;
    output += `- Characters: ${count.characters.toLocaleString()}\n\n`;

    output += `💰 **Estimated Cost (per request)**\n\n`;

    const sortedCosts = Object.entries(count.estimatedCost)
      .sort((a, b) => a[1] - b[1]);

    for (const [model, cost] of sortedCosts) {
      if (cost < 0.01) {
        output += `- ${model}: $${cost.toFixed(4)}\n`;
      } else {
        output += `- ${model}: $${cost.toFixed(2)}\n`;
      }
    }

    return output;
  }

  /**
   * Format compact token count for status bar
   */
  formatCompact(count: TokenCount, primaryModel: string = 'gpt-4o'): string {
    const pricing = MODEL_PRICING[primaryModel];
    const cost = count.estimatedCost[pricing?.name] || 0;

    if (count.tokens < 1000) {
      return `${count.tokens} tokens • $${cost.toFixed(4)}`;
    } else {
      return `${(count.tokens / 1000).toFixed(1)}K tokens • $${cost.toFixed(3)}`;
    }
  }

  /**
   * Check if token count exceeds threshold
   */
  isOverThreshold(tokens: number, threshold: number): boolean {
    return tokens > threshold;
  }

  /**
   * Calculate percentage of context window used
   */
  getContextWindowUsage(tokens: number, contextWindow: number = 128000): number {
    return (tokens / contextWindow) * 100;
  }

  /**
   * Estimate tokens for multiple files
   */
  estimateMultipleFiles(contents: string[]): TokenCount {
    const combinedText = contents.join('\n\n');
    return this.getTokenCount(combinedText);
  }

  /**
   * Get optimization suggestions based on token count
   */
  getOptimizationSuggestions(tokens: number): string[] {
    const suggestions: string[] = [];

    if (tokens > 100000) {
      suggestions.push('⚠️ Very large context (>100K tokens). Consider using optimization mode.');
      suggestions.push('💡 Try "Signatures Only" mode for 95% token reduction');
    } else if (tokens > 50000) {
      suggestions.push('⚠️ Large context (>50K tokens). May impact response time.');
      suggestions.push('💡 Consider using "Diffs Only" mode or reducing file count');
    } else if (tokens > 20000) {
      suggestions.push('💡 Moderate context size. Consider optimization if cost is a concern.');
    }

    return suggestions;
  }

  /**
   * Calculate savings from optimization
   */
  calculateSavings(originalTokens: number, optimizedTokens: number, model: string = 'gpt-4o'): {
    tokenSavings: number;
    costSavings: number;
    percentSaved: number;
  } {
    const pricing = MODEL_PRICING[model];
    const originalCost = (originalTokens / 1000000) * pricing.inputCostPerMillion;
    const optimizedCost = (optimizedTokens / 1000000) * pricing.inputCostPerMillion;

    return {
      tokenSavings: originalTokens - optimizedTokens,
      costSavings: originalCost - optimizedCost,
      percentSaved: ((originalTokens - optimizedTokens) / originalTokens) * 100
    };
  }

  /**
   * Get available models for cost estimation
   */
  getAvailableModels(): string[] {
    return Object.keys(MODEL_PRICING);
  }

  /**
   * Get model pricing information
   */
  getModelPricing(model: string): ModelPricing | undefined {
    return MODEL_PRICING[model];
  }

  dispose(): void {
    // Encoding cleanup handled automatically
  }
}

/**
 * Real-time token counter for interactive updates
 */
export class RealtimeTokenCounter {
  private counter: TokenCounter;
  private debounceTimer: NodeJS.Timeout | undefined;
  private onUpdateCallback: ((count: TokenCount) => void) | undefined;

  constructor() {
    this.counter = new TokenCounter();
  }

  /**
   * Update token count with debouncing
   */
  update(text: string, debounceMs: number = 300): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const count = this.counter.getTokenCount(text);
      if (this.onUpdateCallback) {
        this.onUpdateCallback(count);
      }
    }, debounceMs);
  }

  /**
   * Set callback for token count updates
   */
  onUpdate(callback: (count: TokenCount) => void): void {
    this.onUpdateCallback = callback;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.counter.dispose();
  }
}

export interface UsageMetadata {
  created_at: string;
  last_accessed: string;
  access_count: number;
  last_updated: string;
}

export interface CleanupThresholds {
  minAgeDays: number;
  minAccessCount: number;
  maxInactiveDays: number;
}

export interface PluginConfig {
  enabled: boolean;
  debounceMs?: number;
  autoExtract?: boolean;
  autoInject?: boolean;
  disabledCommands?: string[];
  /**
   * Max token budget for the extraction context preprocessor (conversation + diff + evidence).
   * Approx tokens are estimated as chars/4. Default: 8000
   */
  extractionMaxTokens?: number;
  /**
   * Model to use for knowledge extraction. Format: "providerID/modelID"
   * Example: "minimax/MiniMax-M2.1", "openai/gpt-4o"
   * If not specified, uses OpenCode's default model.
   */
  extractionModel?: string;
  cleanupThresholds?: CleanupThresholds;
}

export interface ToolCallRecord {
  tool: string;
  target?: string;
  timestamp: number;
}

export interface KnowledgeStats {
  hasGlobalIndex: boolean;
  moduleCount: number;
  modules: string[];
}

export interface PreprocessedSummary {
  /** Full transcript: user + assistant turns (text parts only). */
  conversation: string;
  modifiedFiles: string;
  gitDiff: string;
  toolCallsSummary: string;
  codeSnippets: string;
  totalTokens: number;
  truncated: boolean;
}

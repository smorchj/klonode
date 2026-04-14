// Core data model
export type {
  RoutingGraph,
  RoutingNode,
  ContextFile,
  ContextInput,
  ContextOutput,
  Edge,
  GraphMetadata,
  NodeTelemetry,
  LayerLevel,
  NodeType,
  EdgeType,
  TaskCategory,
} from './model/routing-graph.js';

export {
  createRoutingGraph,
  createRoutingNode,
  createEmptyTelemetry,
} from './model/routing-graph.js';

export type { KlonodeConfig, ContextDepth } from './model/config.js';
export { DEFAULT_CONFIG } from './model/config.js';

// Analyzer
export { scanRepository, flattenScan } from './analyzer/scanner.js';
export type { ScanEntry, ScanResult } from './analyzer/scanner.js';

export { detectLanguages, getRepoLanguages } from './analyzer/language-detect.js';
export type { LanguageProfile } from './analyzer/language-detect.js';

export { buildFileDependencies, collapseToDirectoryDeps } from './analyzer/dependency-graph.js';
export type { Dependency, DirectoryDependency } from './analyzer/dependency-graph.js';

export { summarizeDirectory, summarizeAll } from './analyzer/summarizer.js';
export type { DirectorySummary } from './analyzer/summarizer.js';

export { extractDirectoryContent } from './analyzer/content-extractor.js';
export type { DirectoryContent, FileExport, ApiRoute } from './analyzer/content-extractor.js';

export { buildRoutingGraph } from './analyzer/graph-builder.js';

// Generator
export { generateRouting, writeGeneratedFiles, saveConfig, loadConfig } from './generator/generate.js';
export type { GenerateResult, GeneratedFile } from './generator/generate.js';

export { generateLayer0 } from './generator/layer0.js';
export { generateLayer1 } from './generator/layer1.js';
export { generateLayer2, generateLayer2Light, generateLayer2Full, generateAllLayer2, generateAllLayer2Dual } from './generator/layer2.js';
export { estimateTokens, enforceTokenBudget, enforceLineLimit } from './generator/token-budget.js';

// Optimizer
export { recordEvent, loadSession, listSessions, buildAccessMap, buildDirAccessMap, generateTelemetryInstruction } from './optimizer/telemetry.js';
export type { SessionEvent, SessionLog } from './optimizer/telemetry.js';

export { optimize } from './optimizer/optimizer.js';
export type { OptimizationResult, Promotion, Pruning } from './optimizer/optimizer.js';

// Context Checklist
export { ROOT_CHECKLIST, FOLDER_CHECKLISTS, getChecklistForDirectory, validateContext } from './generator/context-checklist.js';
export type { ChecklistItem } from './generator/context-checklist.js';

// Tool Detector
export { detectTools, toolsSummary } from './analyzer/tool-detector.js';
export type { DetectedTool } from './analyzer/tool-detector.js';

// Agents
export { buildAgentRegistry, getAgentContext } from './agents/agent-registry.js';
export type { AgentDefinition, AgentRegistry, AgentRole } from './agents/agent-registry.js';

export { createMessageBus, logInteraction, readSessionLog, listSessionLogs, analyzeInteractions } from './agents/message-bus.js';
export type { InteractionMessage, InteractionSession, InteractionAnalysis, MessageBus } from './agents/message-bus.js';

export { loadCOState, saveCOState, recordInteraction, checkForNewTools, generateSuggestions, generateCOContext } from './agents/chief-organizer.js';
export type { COState, CODecision, ImprovementSuggestion } from './agents/chief-organizer.js';

// Serializer
export { serializeGraph, deserializeGraph, saveGraph, loadGraph } from './serializer/serializer.js';

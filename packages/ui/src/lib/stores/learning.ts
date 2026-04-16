/**
 * Learning store — loads `.klonode/learning.json` into a client-side store
 * so GraphView and TreeView can visualize confidence/urgency per node.
 *
 * Fetches on mount and after session-ended events.
 */
import { writable, derived } from 'svelte/store';

export interface NodeScore {
  path: string;
  confidence: number;
  urgency: number;
  signals: {
    sessionsCount: number;
    readCount: number;
    writeCount: number;
    totalOps: number;
    grepPatterns: number;
    emotionEvents: number;
  };
}

export interface LearningState {
  computedAt: string;
  nodes: Record<string, NodeScore>;
  observationCount: number;
  sessionCount: number;
}

interface LearningStoreState {
  loaded: boolean;
  state: LearningState | null;
}

export const learningStore = writable<LearningStoreState>({
  loaded: false,
  state: null,
});

/**
 * Fetch learning state from the server and populate the store.
 */
export async function loadLearning(): Promise<void> {
  try {
    const res = await fetch('/api/learning');
    const data = await res.json();
    if (data.computed) {
      learningStore.set({
        loaded: true,
        state: {
          computedAt: data.computedAt,
          nodes: data.nodes,
          observationCount: data.observationCount,
          sessionCount: data.sessionCount,
        },
      });
    } else {
      learningStore.set({ loaded: true, state: null });
    }
  } catch {
    learningStore.set({ loaded: true, state: null });
  }
}

/**
 * Derived map: folder path → { confidence, urgency }.
 * GraphView uses this to modulate node appearance.
 */
export const learningScores = derived(learningStore, ($s) => {
  const map = new Map<string, { confidence: number; urgency: number }>();
  if (!$s.state) return map;
  for (const [path, score] of Object.entries($s.state.nodes)) {
    map.set(path, { confidence: score.confidence, urgency: score.urgency });
  }
  return map;
});

/**
 * Workstation self-introspection registry.
 *
 * Every interactive Workstation component calls `defineComponent({...})` once
 * at module-load time to declare what it is, what actions it exposes, and
 * what state keys it owns. The registry then becomes the source of truth that
 * the snapshot endpoint reads from, so Claude (running inside or outside
 * Klonode) can navigate the UI by component ID instead of pixel coordinates.
 *
 * See #64 for the full design.
 */

import { writable, get } from 'svelte/store';

/**
 * A single declared component in the Workstation. Pure metadata — the actual
 * Svelte component it describes is unaware of this type.
 */
export interface ComponentDefinition {
  /** Stable kebab-case identifier (e.g. "chat-panel", "tree-view"). */
  id: string;
  /** One-sentence description of what the component does. */
  role: string;
  /** Parent component ID, if this lives inside another component. */
  parent?: string;
  /**
   * Actions the component exposes. The key is the action name; the value
   * describes the expected argument shape. Action handlers are registered
   * separately via {@link defineComponentAction}.
   */
  actions?: Record<string, ComponentActionSchema>;
  /**
   * Names of observable state slots this component owns. The snapshot
   * endpoint resolves these via {@link defineComponentState}.
   */
  state?: readonly string[];
}

/** Argument schema for a single action. Keys are arg names, values are TS-ish type strings. */
export type ComponentActionSchema = {
  args?: Record<string, string>;
};

/**
 * A function that performs a registered action. Returns whatever the action
 * needs to return to the caller — usually `{ ok: true, ... }` on success or
 * throws with a descriptive error on failure.
 */
export type ComponentActionHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * A function that returns the current value of a registered state slot.
 * Called by the snapshot synthesizer at request time, so it should be fast
 * and side-effect-free.
 */
export type ComponentStateReader = () => unknown;

/** Internal registry entry — definition plus runtime handlers/readers. */
interface RegistryEntry {
  definition: ComponentDefinition;
  actions: Map<string, ComponentActionHandler>;
  state: Map<string, ComponentStateReader>;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Reactive view of the registry — components, store, and downstream consumers
 * subscribe to this so they re-render when new components register. The store
 * itself only carries IDs to avoid serializing function handles into Svelte's
 * subscriber chain; consumers read full entries via {@link getRegistryEntry}.
 */
export const registeredComponentIds = writable<readonly string[]>([]);

/**
 * Register a component with the workstation registry. Call this once at the
 * top of a Svelte component's `<script>` block, alongside its other imports.
 *
 * Re-registering an existing ID overwrites the previous definition rather than
 * throwing — this matches Vite HMR's expectation that modules can re-execute
 * on edit without restarting the page.
 */
export function defineComponent(def: ComponentDefinition): void {
  if (!def.id) {
    // eslint-disable-next-line no-console
    console.warn('[workstation/registry] defineComponent called with empty id', def);
    return;
  }
  const existing = registry.get(def.id);
  registry.set(def.id, {
    definition: def,
    actions: existing?.actions ?? new Map(),
    state: existing?.state ?? new Map(),
  });
  publishIds();
}

/**
 * Register a handler for a previously-declared action. Call this near the
 * function the component will execute when the action fires (often inside
 * `onMount` or alongside a store binding).
 *
 * Validating the action against its declared schema is left to the caller for
 * v1; the registry only cares that the action name exists in the definition.
 */
export function defineComponentAction(
  componentId: string,
  actionName: string,
  handler: ComponentActionHandler,
): void {
  const entry = registry.get(componentId);
  if (!entry) {
    // eslint-disable-next-line no-console
    console.warn(
      `[workstation/registry] defineComponentAction: component "${componentId}" not yet registered`,
    );
    return;
  }
  const declared = entry.definition.actions?.[actionName];
  if (!declared) {
    // eslint-disable-next-line no-console
    console.warn(
      `[workstation/registry] defineComponentAction: "${componentId}" has no declared action "${actionName}"`,
    );
    return;
  }
  entry.actions.set(actionName, handler);
}

/**
 * Register a reader for a previously-declared state slot. The reader is a
 * thunk that returns the current value when the snapshot endpoint asks for it.
 *
 * Pass a function like `() => get(myStore)` so the reader always reflects the
 * latest store value, not a frozen capture.
 */
export function defineComponentState(
  componentId: string,
  stateKey: string,
  reader: ComponentStateReader,
): void {
  const entry = registry.get(componentId);
  if (!entry) {
    // eslint-disable-next-line no-console
    console.warn(
      `[workstation/registry] defineComponentState: component "${componentId}" not yet registered`,
    );
    return;
  }
  if (!entry.definition.state?.includes(stateKey)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[workstation/registry] defineComponentState: "${componentId}" has no declared state "${stateKey}"`,
    );
    return;
  }
  entry.state.set(stateKey, reader);
}

/** Look up the full entry for a component ID — internal use only. */
export function getRegistryEntry(id: string): RegistryEntry | undefined {
  return registry.get(id);
}

/** All currently-registered components, ordered by registration time. */
export function listRegistryEntries(): RegistryEntry[] {
  return [...registry.values()];
}

/**
 * Drop every entry. Only used by tests and the snapshot's full-rebuild path.
 */
export function clearRegistry(): void {
  registry.clear();
  publishIds();
}

function publishIds(): void {
  registeredComponentIds.set([...registry.keys()]);
}

/**
 * The shape of a workstation snapshot — what `/api/workstation/snapshot`
 * returns and what `defineComponentState` readers contribute to.
 */
export interface WorkstationSnapshot {
  /** Wall-clock timestamp the snapshot was synthesized. */
  takenAt: string;
  /** Every registered component, with its declared role and resolved state. */
  components: WorkstationComponentSnapshot[];
}

export interface WorkstationComponentSnapshot {
  id: string;
  role: string;
  parent?: string;
  /** Available action names (no args, just discoverability). */
  actions: string[];
  /** Resolved state values, keyed by the state slot name. Errors become `null`. */
  state: Record<string, unknown>;
}

/**
 * Synthesize a snapshot from the current registry. Cheap — it just walks the
 * registry and calls each state reader once. Safe to call from any context
 * that has access to the Svelte stores the readers depend on.
 */
export function snapshotWorkstation(): WorkstationSnapshot {
  const components: WorkstationComponentSnapshot[] = [];
  for (const entry of registry.values()) {
    const state: Record<string, unknown> = {};
    for (const [key, reader] of entry.state) {
      try {
        state[key] = reader();
      } catch {
        state[key] = null;
      }
    }
    components.push({
      id: entry.definition.id,
      role: entry.definition.role,
      parent: entry.definition.parent,
      actions: Object.keys(entry.definition.actions ?? {}),
      state,
    });
  }
  return { takenAt: new Date().toISOString(), components };
}

/**
 * Dispatch a registered action by component ID and action name. Returns
 * whatever the handler returns, or throws if either the component or action
 * is unknown.
 */
export async function dispatchComponentAction(
  componentId: string,
  actionName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const entry = registry.get(componentId);
  if (!entry) {
    throw new Error(`unknown component: "${componentId}"`);
  }
  const handler = entry.actions.get(actionName);
  if (!handler) {
    throw new Error(`unknown action "${actionName}" on component "${componentId}"`);
  }
  return await handler(args);
}

// Re-export `get` so consumers don't have to dual-import from svelte/store.
export { get };

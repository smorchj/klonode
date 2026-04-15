/**
 * Watch settings — small persisted store for the session watcher scope
 * toggle (project-only vs machine-wide). Introduced as part of the
 * contextualizer pivot (#77) after `stores/settings.ts` was deleted along
 * with the rest of the chat wrapper surface.
 *
 * Kept deliberately minimal: one field, localStorage-backed, no server
 * sync. If we ever need more watcher-related settings they can live here
 * too rather than resurrecting the old monolithic settings store.
 */
import { writable } from 'svelte/store';

export type WatchScope = 'project' | 'machine';

export interface WatchSettings {
  scope: WatchScope;
}

const STORAGE_KEY = 'klonode-watch-settings';

const defaults: WatchSettings = {
  scope: 'project',
};

function load(): WatchSettings {
  if (typeof localStorage === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<WatchSettings>;
    return {
      scope: saved.scope === 'machine' ? 'machine' : 'project',
    };
  } catch {
    return defaults;
  }
}

function save(settings: WatchSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* quota full — not critical, setting just won't persist */ }
}

export const watchSettings = writable<WatchSettings>(load());
watchSettings.subscribe(save);

export function setWatchScope(scope: WatchScope): void {
  watchSettings.update(s => ({ ...s, scope }));
}

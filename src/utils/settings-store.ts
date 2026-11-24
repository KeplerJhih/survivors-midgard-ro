import { storage } from '#imports';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@/core/settings';

const item = storage.defineItem<Settings>('local:settings', { fallback: DEFAULT_SETTINGS });

export async function loadSettings(): Promise<Settings> {
  return mergeSettings(await item.getValue());
}

export async function saveSettings(settings: Settings): Promise<void> {
  await item.setValue(settings);
}

export function watchSettings(cb: (settings: Settings) => void): () => void {
  return item.watch((v) => cb(mergeSettings(v)));
}

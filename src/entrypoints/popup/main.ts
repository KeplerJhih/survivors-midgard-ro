import { RELOAD_MESSAGE } from '@/core/messages';
import type { Settings } from '@/core/settings';
import { loadSettings, saveSettings } from '@/utils/settings-store';

type Path = string; // 例如 'mobile'、'bot.enabled'

function getAt(obj: Settings, path: Path): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

function setAt(obj: Settings, path: Path, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<Record<string, unknown>>(
    (o, k) => o[k] as Record<string, unknown>,
    obj as unknown as Record<string, unknown>,
  );
  parent[last] = value;
}

async function main() {
  const settings = await loadSettings();
  const status = document.getElementById('status')!;
  const fields = document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]');

  for (const el of fields) {
    const path = el.dataset.key!;
    const value = getAt(settings, path);
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = String(value);

    el.addEventListener('change', async () => {
      let next: unknown;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') next = el.checked;
      else if (el instanceof HTMLInputElement && el.type === 'number') next = Number(el.value);
      else next = el.value;
      setAt(settings, path, next);
      await saveSettings(settings);
      status.textContent = '已儲存';
      setTimeout(() => (status.textContent = ''), 1200);
    });
  }
}

document.getElementById('reload')!.addEventListener('click', () => {
  // 外掛重新載入時 popup 會被關閉，不等回應
  browser.runtime.sendMessage({ type: RELOAD_MESSAGE }).catch(() => {});
});

main();

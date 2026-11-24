export interface Overlay {
  setVisible(visible: boolean): void;
  render(data: Record<string, unknown>): void;
}

/** 疊在遊戲上的半透明 debug 面板（不攔截滑鼠） */
export function createOverlay(doc: Document): Overlay {
  const el = doc.createElement('pre');
  el.id = 'msbot-overlay';
  Object.assign(el.style, {
    position: 'fixed',
    left: '8px',
    bottom: '8px',
    zIndex: '2147483647',
    margin: '0',
    padding: '6px 8px',
    font: '11px/1.4 ui-monospace, monospace',
    color: '#d7ffd7',
    background: 'rgba(0,0,0,0.6)',
    borderRadius: '6px',
    pointerEvents: 'none',
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  doc.body.appendChild(el);

  let visible = false;
  return {
    setVisible(v) {
      visible = v;
      el.style.display = v ? 'block' : 'none';
    },
    render(data) {
      if (!visible) return;
      el.textContent = Object.entries(data)
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
        .join('\n');
    },
  };
}

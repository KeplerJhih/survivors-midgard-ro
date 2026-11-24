export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

/** 固定前綴方便在 console 過濾；debug 層級由 isDebug() 動態決定 */
export function createLogger(isDebug: () => boolean, prefix = '[MSBot]'): Logger {
  return {
    debug: (...a) => {
      if (isDebug()) console.debug(prefix, ...a);
    },
    info: (...a) => console.info(prefix, ...a),
    warn: (...a) => console.warn(prefix, ...a),
  };
}

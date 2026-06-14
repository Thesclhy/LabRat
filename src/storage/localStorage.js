const BLANK_STORAGE_PREFIX = "labrat_blank_";

function blankStorageKey(key) {
  if (typeof key !== "string") return key;
  if (key.startsWith(BLANK_STORAGE_PREFIX)) return key;
  return key.startsWith("labrat_")
    ? `${BLANK_STORAGE_PREFIX}${key.slice("labrat_".length)}`
    : key;
}

export const ls = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(blankStorageKey(key));
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(blankStorageKey(key), JSON.stringify(value));
  },
};

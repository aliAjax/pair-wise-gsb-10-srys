// 本地保存：拓扑数据的读写，与选择集、布局规则互不知晓
const KEY = 'topology';

export function loadTopology(fallback) {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveTopology(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 存储不可用时静默失败 */
  }
}

// 种子拓扑（数据层）。
export const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530, ip: '10.0.2.22' },
  ],
  edges: [
    ['gw', 'sw1'],
    ['gw', 'sw2'],
    ['sw1', 'web'],
    ['sw1', 'db'],
    ['sw2', 'user'],
  ],
};

// 本地保存按职责拆三个键：拓扑文档 / 布局规则。
// 选择集刻意不入此文件——它只是本次会话的交互状态，不做本地保存。
export const STORAGE = {
  doc: 'topology.doc.v2',
  rules: 'topology.rules.v1',
};

export const DEFAULT_RULES = {
  gap: 24, // 等距排布时相邻设备间距
  snap: 8, // 拖动时网格吸附步长
  margin: 12, // 新设备相对画布左上角的留白基准
};

export function loadDoc() {
  try {
    const raw = localStorage.getItem(STORAGE.doc);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        return parsed;
      }
    }
  } catch {
    /* 损坏的存档回退到种子 */
  }
  return seed;
}

export function loadRules() {
  try {
    const raw = localStorage.getItem(STORAGE.rules);
    if (raw) return { ...DEFAULT_RULES, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_RULES };
}

export const saveDoc = (doc) =>
  localStorage.setItem(STORAGE.doc, JSON.stringify(doc));

export const saveRules = (rules) =>
  localStorage.setItem(STORAGE.rules, JSON.stringify(rules));

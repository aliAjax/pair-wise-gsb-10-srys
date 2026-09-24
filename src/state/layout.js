// 布局规则：节点几何、碰撞/越界检测、对齐与等距排布，全部为纯函数
export const NODE_W = 85;
export const NODE_H = 62;

export const nodeRect = (n) => ({
  left: n.x - NODE_W / 2,
  top: n.y - NODE_H / 2,
  right: n.x + NODE_W / 2,
  bottom: n.y + NODE_H / 2,
});

export const normRect = ({ x0, y0, x1, y1 }) => ({
  left: Math.min(x0, x1),
  top: Math.min(y0, y1),
  right: Math.max(x0, x1),
  bottom: Math.max(y0, y1),
});

const overlaps = (a, b, pad = 0) =>
  a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

// 框选：返回与矩形相交的节点 id
export function nodesInRect(nodes, rect) {
  return nodes.filter((n) => overlaps(nodeRect(n), rect)).map((n) => n.id);
}

// 组拖动校验：positions 为 {id:{x,y}}，返回越界或撞到未选设备的成员 id 集合
export function findBlocked(nodes, positions, bounds) {
  const moving = new Set(Object.keys(positions));
  const blocked = new Set();
  for (const n of nodes) {
    if (!moving.has(n.id)) continue;
    const r = nodeRect(positions[n.id]);
    const out = r.left < 0 || r.top < 0 || r.right > bounds.width || r.bottom > bounds.height;
    const hit = nodes.some((m) => !moving.has(m.id) && overlaps(r, nodeRect(m), 6));
    if (out || hit) blocked.add(n.id);
  }
  return blocked;
}

// 对齐：left / centerX / right / top / centerY / bottom（按节点中心）
export function align(nodes, ids, mode) {
  const set = new Set(ids);
  const sel = nodes.filter((n) => set.has(n.id));
  if (sel.length < 2) return nodes;
  const xs = sel.map((n) => n.x);
  const ys = sel.map((n) => n.y);
  const target = {
    left: Math.min(...xs),
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    right: Math.max(...xs),
    top: Math.min(...ys),
    centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
    bottom: Math.max(...ys),
  }[mode];
  const horizontal = mode === 'left' || mode === 'centerX' || mode === 'right';
  return nodes.map((n) => {
    if (!set.has(n.id)) return n;
    return horizontal ? { ...n, x: target } : { ...n, y: target };
  });
}

// 等距排布：首尾不动，中间成员按轴均匀分布
export function distribute(nodes, ids, axis) {
  const set = new Set(ids);
  const sel = nodes
    .filter((n) => set.has(n.id))
    .sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
  if (sel.length < 3) return nodes;
  const first = sel[0];
  const last = sel[sel.length - 1];
  const step = (axis === 'x' ? last.x - first.x : last.y - first.y) / (sel.length - 1);
  const at = {};
  sel.forEach((n, i) => {
    at[n.id] = (axis === 'x' ? first.x : first.y) + step * i;
  });
  return nodes.map((n) => {
    if (!set.has(n.id)) return n;
    return axis === 'x' ? { ...n, x: at[n.id] } : { ...n, y: at[n.id] };
  });
}

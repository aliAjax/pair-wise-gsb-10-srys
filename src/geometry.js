// 纯几何规则：节点包围盒、碰撞检测、对齐/等距排布。
// 这里只描述"布局规则"，不依赖 React，也不负责持久化。

export const NODE_W = 84;
export const NODE_H = 62;
// 节点锚点 (x, y) 是其几何中心，节点按钮用 left = x - W/2 渲染。
export const HALF_W = NODE_W / 2;
export const HALF_H = NODE_H / 2;

export const boundsOf = (nodes) => {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  return {
    left: Math.min(...xs) - HALF_W,
    right: Math.max(...xs) + HALF_W,
    top: Math.min(...ys) - HALF_H,
    bottom: Math.max(...ys) + HALF_H,
  };
};

export const inside = (node, box) =>
  node.x - HALF_W >= box.left &&
  node.x + HALF_W <= box.right &&
  node.y - HALF_H >= box.top &&
  node.y + HALF_H <= box.bottom;

export const intersects = (a, b) =>
  !(
    a.x + HALF_W <= b.x - HALF_W ||
    a.x - HALF_W >= b.x + HALF_W ||
    a.y + HALF_H <= b.y - HALF_H ||
    a.y - HALF_H >= b.y + HALF_H
  );

// 判定一组 ID 平移 (dx, dy) 后，哪些成员越界或撞到"未选中"的设备。
// 返回受阻成员 ID 集合；组内成员彼此之间不算碰撞（相对位置保持不变）。
export function blockedAfterMove(nodes, ids, dx, dy, canvasW, canvasH) {
  const idSet = new Set(ids);
  const moving = nodes.filter((n) => idSet.has(n.id));
  const others = nodes.filter((n) => !idSet.has(n.id));
  const blocked = new Set();

  for (const n of moving) {
    const np = { x: n.x + dx, y: n.y + dy };
    const out =
      np.x - HALF_W < 0 ||
      np.y - HALF_H < 0 ||
      np.x + HALF_W > canvasW ||
      np.y + HALF_H > canvasH;
    if (out) blocked.add(n.id);
    for (const o of others) {
      if (intersects(np, o)) {
        blocked.add(n.id);
        break;
      }
    }
  }
  return blocked;
}

// 对齐 / 等距：返回新的 nodes 数组与受阻成员集合。
// 有任何成员越界或与组外设备重叠时，整体不执行（原子性，不挪一半）。
function commit(nodes, idSet, updates, canvasW, canvasH) {
  const next = nodes.map((n) =>
    updates[n.id] ? { ...n, ...updates[n.id] } : n
  );
  const blocked = blockedAfterMove(
    next,
    [...idSet],
    0,
    0,
    canvasW,
    canvasH
  );
  return { next, blocked };
}

export function alignNodes(nodes, ids, mode, canvasW, canvasH) {
  const group = nodes.filter((n) => ids.includes(n.id));
  if (group.length < 2) return { next: nodes, blocked: new Set() };
  const box = boundsOf(group);
  const updates = {};
  for (const n of group) {
    if (mode === 'left') updates[n.id] = { x: box.left + HALF_W };
    if (mode === 'right') updates[n.id] = { x: box.right - HALF_W };
    if (mode === 'top') updates[n.id] = { y: box.top + HALF_H };
    if (mode === 'bottom') updates[n.id] = { y: box.bottom - HALF_H };
    if (mode === 'hcenter') updates[n.id] = { x: (box.left + box.right) / 2 };
    if (mode === 'vcenter') updates[n.id] = { y: (box.top + box.bottom) / 2 };
  }
  return commit(nodes, new Set(ids), updates, canvasW, canvasH);
}

export function distributeNodes(nodes, ids, axis, gap, canvasW, canvasH) {
  const group = nodes
    .filter((n) => ids.includes(n.id))
    .sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
  if (group.length < 3) return { next: nodes, blocked: new Set() };

  const key = axis === 'h' ? 'x' : 'y';
  const span = axis === 'h' ? NODE_W : NODE_H;
  const first = group[0];
  const updates = { [first.id]: {} };
  for (let i = 1; i < group.length; i++) {
    updates[group[i].id] = {
      [key]: first[key] + i * (span + gap),
    };
  }
  return commit(nodes, new Set(ids), updates, canvasW, canvasH);
}

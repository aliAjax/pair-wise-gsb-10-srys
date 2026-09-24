// 选择集：只负责 id 集合的纯函数操作，不关心布局与保存
export const only = (id) => [id];
export const toggle = (sel, id) => (sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
export const union = (a, b) => [...new Set([...a, ...b])];
export const clear = () => [];
// 数据变化（撤销、删除）后剔除已不存在的 id
export const prune = (sel, nodes) => sel.filter((id) => nodes.some((n) => n.id === id));

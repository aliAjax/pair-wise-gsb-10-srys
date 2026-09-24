import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  HALF_W,
  HALF_H,
  NODE_W,
  alignNodes,
  blockedAfterMove,
  boundsOf,
  distributeNodes,
  inside,
} from './geometry';
import {
  DEFAULT_RULES,
  loadDoc,
  loadRules,
  saveDoc,
  saveRules,
} from './seed';
import { useHistory } from './history';

const ICONS = { router: '◉', switch: '▦', server: '▣', device: '▱' };
const iconOf = (t) => ICONS[t] || ICONS.device;

const snapVal = (v, step) =>
  step > 1 ? Math.round(v / step) * step : Math.round(v);

function App() {
  const history = useHistory(loadDoc);
  const { doc, setDoc, live, commitBaseline, undo, redo } = history;

  // 选择集是纯交互状态：会话内有效，不做本地保存，与布局规则/拓扑文档分开。
  const [selection, setSelection] = useState(() => ['gw']);
  const [activeId, setActiveId] = useState('gw');
  const [rules, setRules] = useState(loadRules);

  const [marquee, setMarquee] = useState(null); // {x0,y0,x1,y1,additive}
  const [blocked, setBlocked] = useState(() => new Set());
  const [notice, setNotice] = useState('');
  const [savedAt, setSavedAt] = useState('已自动保存');

  const boardRef = useRef(null);
  const marqueeRef = useRef(null);
  const dragRef = useRef(null); // {ids, start:{x,y}, origins:Map, grid}
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  // 事件处理器只绑定一次，所有渲染期数据通过 ref 读取，避免拖动途中闭包过期。
  const nodesRef = useRef(doc.nodes);
  nodesRef.current = doc.nodes;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const toastTimer = useRef(null);
  const saveTimer = useRef(null);

  const notify = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(''), 2400);
  }, []);

  /* ---------- 本地保存：与撤销栈、选择集解耦 ---------- */
  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDoc(doc);
      setSavedAt('已自动保存');
    }, 300);
  }, [doc]);

  useEffect(() => saveRules(rules), [rules]);

  /* ---------- 选择集随文档变化自动裁剪（删除/撤销后） ---------- */
  useEffect(() => {
    const alive = new Set(doc.nodes.map((n) => n.id));
    setSelection((prev) => {
      const next = prev.filter((id) => alive.has(id));
      return next.length === prev.length ? prev : next;
    });
    setActiveId((prev) => (prev && alive.has(prev) ? prev : null));
  }, [doc.nodes]);

  const activeNode = doc.nodes.find((n) => n.id === activeId) || null;

  /* ---------- 窗口级鼠标事件：拖出画布也能继续/结束 ---------- */
  useEffect(() => {
    const point = (e) => {
      const r = boardRef.current.getBoundingClientRect();
      return {
        x: Math.min(Math.max(e.clientX - r.left, 0), r.width),
        y: Math.min(Math.max(e.clientY - r.top, 0), r.height),
        w: r.width,
        h: r.height,
      };
    };

    const onMove = (e) => {
      // 组拖动：整组保持相对位置；吸附锚点所在成员，其余按整数平移跟随。
      const d = dragRef.current;
      if (d) {
        const p = point(e);
        const anchor = d.origins.get(d.anchor);
        let nx = anchor.x + (p.x - d.start.x);
        let ny = anchor.y + (p.y - d.start.y);
        if (d.grid > 1) {
          nx = snapVal(nx, d.grid);
          ny = snapVal(ny, d.grid);
        }
        const dx = Math.round(nx - anchor.x);
        const dy = Math.round(ny - anchor.y);
        // 以拖动起点的布局做碰撞判定（origins 是未平移的真实位置）。
        const originNodes = nodesRef.current.map(
          (n) => d.origins.get(n.id) ?? n
        );
        const hit = blockedAfterMove(originNodes, d.ids, dx, dy, p.w, p.h);
        blockedRef.current = hit;
        setBlocked(hit);
        live((cur) => ({
          ...cur,
          nodes: cur.nodes.map((n) =>
            d.origins.has(n.id)
              ? { ...n, x: d.origins.get(n.id).x + dx, y: d.origins.get(n.id).y + dy }
              : n
          ),
        }));
        return;
      }
      // 框选
      const m = marqueeRef.current;
      if (m) {
        const p = point(e);
        const box = {
          x0: Math.min(m.x0, p.x),
          y0: Math.min(m.y0, p.y),
          x1: Math.max(m.x0, p.x),
          y1: Math.max(m.y0, p.y),
        };
        m.cur = box;
        setMarquee(box);
        const hit = doc.nodes
          .filter((n) => inside(n, { left: box.x0, top: box.y0, right: box.x1, bottom: box.y1 }))
          .map((n) => n.id);
        setSelection(m.additive ? Array.from(new Set([...m.base, ...hit])) : hit);
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        const hit = blockedRef.current;
        if (hit.size > 0) {
          // 受阻：松手整组退回原位，不产生撤销点。
          setDoc(
            (cur) => ({
              ...cur,
              nodes: cur.nodes.map((n) =>
                d.origins.has(n.id) ? { ...n, ...d.origins.get(n.id) } : n
              ),
            }),
            { record: false }
          );
          notify(`已取消：${hit.size} 个成员越界或撞到未选设备，整组退回原位`);
        } else {
          let moved = false;
          for (const [id, o] of d.origins) {
            const cur = nodesRef.current.find((n) => n.id === id);
            if (cur && (cur.x !== o.x || cur.y !== o.y)) {
              moved = true;
              break;
            }
          }
          if (moved) commitBaseline(); // 整组移动 = 一次撤销
        }
        setBlocked(new Set());
        return;
      }
      const m = marqueeRef.current;
      if (m) {
        marqueeRef.current = null;
        const c = m.cur;
        const isClick =
          !c || (Math.abs(c.x1 - c.x0) < 4 && Math.abs(c.y1 - c.y0) < 4);
        if (isClick && !m.additive) {
          setSelection([]);
          setActiveId(null);
        }
        setMarquee(null);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [live, setDoc, commitBaseline, notify]);

  /* ---------- 选择操作 ---------- */
  const selectOnly = (id) => {
    setSelection([id]);
    setActiveId(id);
  };

  const toggleSelect = (id) => {
    setSelection((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        setActiveId((a) => (a === id ? next[0] ?? null : a));
        return next;
      }
      setActiveId(id);
      return [...prev, id];
    });
  };

  const startNodeDrag = (e, id) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const cur = selectionRef.current;
    let ids;
    if (e.shiftKey) {
      // Shift+点：先切换选择集，再以新选择集开始拖动
      ids = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      setSelection(ids);
      if (!cur.includes(id)) setActiveId(id);
      else if (id === activeId) setActiveId(ids[0] ?? null);
    } else if (!cur.includes(id)) {
      ids = [id];
      selectOnly(id);
    } else {
      ids = cur;
    }
    if (!ids.length) return;
    const r = boardRef.current.getBoundingClientRect();
    const origins = new Map(
      nodesRef.current
        .filter((n) => ids.includes(n.id))
        .map((n) => [n.id, { x: n.x, y: n.y }])
    );
    dragRef.current = {
      ids,
      anchor: id,
      origins,
      start: { x: e.clientX - r.left, y: e.clientY - r.top },
      grid: Number(rules.snap) || 0,
    };
  };

  const startMarquee = (e) => {
    if (e.button !== 0) return;
    const r = boardRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    marqueeRef.current = { x0: x, y0: y, additive: e.shiftKey, base: selection };
    setMarquee({ x0: x, y0: y, x1: x, y1: y });
  };

  /* ---------- 键盘：全选 / 删除 / Esc ---------- */
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(doc.nodes.map((n) => n.id));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.length) {
          e.preventDefault();
          removeIds(selection);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (dragRef.current) return;
        setSelection([]);
        setActiveId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, doc]);

  /* ---------- 文档操作（每个都是一个撤销点） ---------- */
  const addNode = (type = 'device') => {
    const id = 'node' + Date.now();
    const labels = { router: '路由器', switch: '交换机', server: '服务器', device: '终端设备' };
    setDoc((cur) => ({
      ...cur,
      nodes: [
        ...cur.nodes,
        {
          id,
          name: labels[type],
          type,
          x: 120 + (cur.nodes.length * 40) % 600,
          y: 120 + (cur.nodes.length * 56) % 360,
          ip: '192.168.0.2',
        },
      ],
    }));
    selectOnly(id);
    notify('已添加设备');
  };

  const removeIds = (ids) => {
    const set = new Set(ids);
    setDoc((cur) => ({
      nodes: cur.nodes.filter((n) => !set.has(n.id)),
      edges: cur.edges.filter(([a, b]) => !set.has(a) && !set.has(b)),
    }));
    setSelection((prev) => prev.filter((id) => !set.has(id)));
    setActiveId((a) => (a && set.has(a) ? null : a));
    notify(ids.length > 1 ? `已移除 ${ids.length} 个设备及其连接` : '设备已删除，相关连接已清理');
  };

  const addEdge = (other) => {
    if (!activeId || !other || other === activeId) return;
    if (doc.edges.some(([a, b]) => (a === activeId && b === other) || (b === activeId && a === other))) {
      notify('连接已存在');
      return;
    }
    setDoc((cur) => ({ ...cur, edges: [...cur.edges, [activeId, other]] }));
    notify('连接已创建');
  };

  const removeEdge = (other) => {
    setDoc((cur) => ({
      ...cur,
      edges: cur.edges.filter(
        ([a, b]) => !((a === activeId && b === other) || (b === activeId && a === other))
      ),
    }));
    notify('连接已删除');
  };

  const patchActive = (patch, commitNow = false) => {
    if (!activeId) return;
    const id = activeId;
    live((cur) => ({
      ...cur,
      nodes: cur.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
    if (commitNow) commitBaseline();
  };

  /* ---------- 对齐 / 等距：任一成员受阻则整组不执行（原子动作） ---------- */
  const canvasSize = () => {
    const r = boardRef.current?.getBoundingClientRect();
    return { w: r?.width || 1000, h: r?.height || 600 };
  };

  const flashBlocked = (set) => {
    setBlocked(set);
    setTimeout(() => setBlocked(new Set()), 900);
  };

  const applyAlign = (mode) => {
    if (selection.length < 2) {
      notify('请至少选择两个设备');
      return;
    }
    const { w, h } = canvasSize();
    const { next, blocked: hit } = alignNodes(doc.nodes, selection, mode, w, h);
    if (hit.size) {
      flashBlocked(hit);
      notify(`无法对齐：${hit.size} 个成员会越界或重叠，整组保持不变`);
      return;
    }
    setDoc(() => next); // 整组一次撤销
    notify('对齐完成');
  };

  const applyDistribute = (axis) => {
    if (selection.length < 3) {
      notify('等距排布至少需要三个设备');
      return;
    }
    const { w, h } = canvasSize();
    const { next, blocked: hit } = distributeNodes(
      doc.nodes,
      selection,
      axis,
      Number(rules.gap) || 0,
      w,
      h
    );
    if (hit.size) {
      flashBlocked(hit);
      notify(`无法排布：${hit.size} 个成员会越界或重叠，整组保持不变`);
      return;
    }
    setDoc(() => next);
    notify('等距排布完成');
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    notify('JSON 已导出');
  };

  const validate = () => {
    const linked = new Set(doc.edges.flat());
    const isolated = doc.nodes.filter((n) => !linked.has(n.id));
    notify(isolated.length ? `发现 ${isolated.length} 个孤立节点` : '拓扑检查通过：没有孤立节点');
  };

  const saveNow = () => {
    saveDoc(doc);
    saveRules(rules);
    setSavedAt('刚刚手动保存');
    notify('拓扑与布局规则已保存');
  };

  /* ---------- 渲染数据 ---------- */
  const groupBox = useMemo(
    () => (selection.length > 1 ? boundsOf(doc.nodes.filter((n) => selection.includes(n.id))) : null),
    [doc.nodes, selection]
  );
  const selSet = useMemo(() => new Set(selection), [selection]);
  const activeEdges = activeNode
    ? doc.edges
        .filter(([a, b]) => a === activeId || b === activeId)
        .map(([a, b]) => (a === activeId ? b : a))
    : [];

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div>
            <strong>NETSCAPE</strong>
            <small>TOPOLOGY STUDIO</small>
          </div>
        </div>
        <div className="file">
          <span className="dot"></span>
          <div>
            <strong>office-network.json</strong>
            <small>{savedAt}</small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={validate}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button className="save" onClick={saveNow}>保存更改</button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button onClick={() => addNode('device')}>＋ 设备</button>
          <button onClick={() => addNode('server')}>＋ 服务器</button>
          <button onClick={() => addNode('switch')}>＋ 交换机</button>
          <button onClick={() => addNode('router')}>＋ 路由器</button>
        </div>
        <div className="tool-group">
          <span>编辑</span>
          <button onClick={undo} disabled={!history.canUndo} title="Ctrl/Cmd+Z">↶ 撤销</button>
          <button onClick={redo} disabled={!history.canRedo} title="Ctrl/Cmd+Shift+Z">↷ 恢复</button>
        </div>
        <div className="tool-group zoom">
          <button title="缩放（占位）">−</button>
          <span>100%</span>
          <button title="缩放（占位）">＋</button>
        </div>
      </div>

      <div className="workspace">
        <aside className="inventory">
          <div className="section-title">
            <span>设备库</span>
            <small>{doc.nodes.length} 个节点</small>
          </div>
          <div className="device-types">
            {[['router', '◉', '路由器'], ['switch', '▦', '交换机'], ['server', '▣', '服务器'], ['device', '▱', '终端设备']].map(
              ([t, i, l]) => (
                <button onClick={() => addNode(t)} key={t}>
                  <i className={t}>{i}</i>
                  {l}
                  <span>＋</span>
                </button>
              )
            )}
          </div>
          <div className="section-title nodes-head">
            <span>图中节点</span>
            <small>点击选中 · Shift 多选</small>
          </div>
          <div className="node-list">
            {doc.nodes.map((n) => (
              <button
                className={selSet.has(n.id) ? 'sel' : ''}
                onClick={(e) => (e.shiftKey ? toggleSelect(n.id) : selectOnly(n.id))}
                key={n.id}
              >
                <i className={n.type}>{iconOf(n.type)}</i>
                <span>
                  <strong>{n.name}</strong>
                  <small>{n.ip}</small>
                </span>
                <b>›</b>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div
            className={'canvas' + (dragRef.current ? ' dragging' : '')}
            ref={boardRef}
            onMouseDown={startMarquee}
          >
            {doc.edges.map(([a, b], i) => {
              const n1 = doc.nodes.find((n) => n.id === a);
              const n2 = doc.nodes.find((n) => n.id === b);
              if (!n1 || !n2) return null;
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <div
                  className="edge"
                  key={i}
                  style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
                >
                  <span></span>
                </div>
              );
            })}

            {groupBox && (
              <div
                className="group-box"
                style={{
                  left: groupBox.left - 8,
                  top: groupBox.top - 8,
                  width: groupBox.right - groupBox.left + 16,
                  height: groupBox.bottom - groupBox.top + 16,
                }}
              />
            )}

            {marquee && (
              <div
                className="marquee"
                style={{
                  left: marquee.x0,
                  top: marquee.y0,
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}

            {doc.nodes.map((n) => (
              <button
                className={
                  'node ' +
                  n.type +
                  (selSet.has(n.id) ? ' picked' : '') +
                  (n.id === activeId ? ' active' : '') +
                  (blocked.has(n.id) ? ' blocked' : '')
                }
                style={{ left: n.x - HALF_W, top: n.y - HALF_H, width: NODE_W }}
                onMouseDown={(e) => startNodeDrag(e, n.id)}
                key={n.id}
              >
                {blocked.has(n.id) && <em className="block-tag">受阻</em>}
                <i>{iconOf(n.type)}</i>
                <strong>{n.name}</strong>
                <small>{n.ip}</small>
              </button>
            ))}

            <div className="legend">
              <span><i className="router"></i>路由器</span>
              <span><i className="switch"></i>交换机</span>
              <span><i className="server"></i>服务器</span>
            </div>
          </div>
          <div className="canvas-footer">
            <span>
              拖动节点调整位置 · 空白处框选 · Shift+点击多选 · 已选 {selection.length} / {doc.nodes.length} · {doc.edges.length} 条连接
              {blocked.size > 0 && <b className="warn">（{blocked.size} 个成员受阻）</b>}
            </span>
            <span>选择集仅本会话保留 · 布局规则与拓扑分开保存</span>
          </div>
        </section>

        <aside className="inspector">
          {selection.length > 1 && (
            <GroupPanel
              doc={doc}
              selection={selection}
              rules={rules}
              setRules={setRules}
              onAlign={applyAlign}
              onDistribute={applyDistribute}
              onRenameLive={(id, name) => {
                live((cur) => ({
                  ...cur,
                  nodes: cur.nodes.map((n) => (n.id === id ? { ...n, name } : n)),
                }));
              }}
              onRenameCommit={commitBaseline}
              onFocus={(id) => {
                selectOnly(id);
              }}
              onRemove={(id) => removeIds([id])}
              onRemoveAll={() => removeIds(selection)}
            />
          )}

          {selection.length <= 1 && activeNode && (
            <>
              <div className="section-title">
                <span>属性</span>
                <small>{activeNode.type}</small>
              </div>
              <label>
                设备名称
                <input
                  value={activeNode.name}
                  onChange={(e) => patchActive({ name: e.target.value })}
                  onBlur={commitBaseline}
                />
              </label>
              <label>
                IP 地址
                <input
                  value={activeNode.ip}
                  onChange={(e) => patchActive({ ip: e.target.value })}
                  onBlur={commitBaseline}
                />
              </label>
              <label>
                设备类型
                <select
                  value={activeNode.type}
                  onChange={(e) => patchActive({ type: e.target.value }, true)}
                >
                  <option value="router">路由器</option>
                  <option value="switch">交换机</option>
                  <option value="server">服务器</option>
                  <option value="device">终端设备</option>
                </select>
              </label>
              <div className="inspector-actions">
                <button className="danger" onClick={() => removeIds([activeNode.id])}>删除设备</button>
              </div>
              <div className="connections">
                <div className="section-title">
                  <span>连接</span>
                  <small>{activeEdges.length} 条</small>
                </div>
                {activeEdges.map((oid) => {
                  const other = doc.nodes.find((n) => n.id === oid);
                  if (!other) return null;
                  return (
                    <div className="connection" key={oid}>
                      <span className={'mini ' + other.type}></span>
                      <strong>{other.name}</strong>
                      <small>在线</small>
                      <button className="link-x" title="移除连接" onClick={() => removeEdge(oid)}>×</button>
                    </div>
                  );
                })}
                <AddLink doc={doc} activeNode={activeNode} onAdd={addEdge} />
              </div>
            </>
          )}

          {selection.length === 0 && (
            <div className="empty-hint">
              <div className="section-title"><span>属性</span></div>
              <p>框选或按住 Shift 点选设备。<br />拖动任一成员即可移动整组。</p>
            </div>
          )}
        </aside>
      </div>

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function AddLink({ doc, activeNode, onAdd }) {
  const candidates = doc.nodes.filter(
    (n) =>
      n.id !== activeNode.id &&
      !doc.edges.some(([a, b]) => (a === activeNode.id && b === n.id) || (b === activeNode.id && a === n.id))
  );
  const [val, setVal] = useState('');
  if (!candidates.length) return <p className="link-note">已与全部设备相连</p>;
  return (
    <div className="add-link">
      <select value={val} onChange={(e) => setVal(e.target.value)}>
        <option value="">选择设备…</option>
        {candidates.map((n) => (
          <option key={n.id} value={n.id}>{n.name}（{n.ip}）</option>
        ))}
      </select>
      <button disabled={!val} onClick={() => { onAdd(val); setVal(''); }}>⌁ 连接</button>
    </div>
  );
}

function GroupPanel({
  selection, doc, rules, setRules,
  onAlign, onDistribute, onRenameLive, onRenameCommit, onFocus, onRemove, onRemoveAll,
}) {
  const members = doc.nodes.filter((n) => selection.includes(n.id));
  const alignBtns = [
    ['left', '⬅ 左对齐'], ['hcenter', '⬌ 水平居中'], ['right', '➡ 右对齐'],
    ['top', '⬆ 顶对齐'], ['vcenter', '⬍ 垂直居中'], ['bottom', '⬇ 底对齐'],
  ];
  return (
    <>
      <div className="section-title">
        <span>选中设备组</span>
        <small>{selection.length} 个成员</small>
      </div>

      <p className="panel-label">对齐（至少 2 个）</p>
      <div className="align-grid">
        {alignBtns.map(([m, l]) => (
          <button key={m} onClick={() => onAlign(m)}>{l}</button>
        ))}
      </div>

      <p className="panel-label">等距排布（至少 3 个）</p>
      <div className="align-grid two">
        <button onClick={() => onDistribute('h')}>↔ 横向等距</button>
        <button onClick={() => onDistribute('v')}>↕ 纵向等距</button>
      </div>

      <p className="panel-label">布局规则（独立保存）</p>
      <div className="rule-row">
        <label>等距间距<input type="number" min="0" value={rules.gap}
          onChange={(e) => setRules((r) => ({ ...r, gap: Number(e.target.value) }))} /></label>
        <label>网格吸附<input type="number" min="0" value={rules.snap}
          onChange={(e) => setRules((r) => ({ ...r, snap: Number(e.target.value) }))} /></label>
      </div>

      <div className="inspector-actions">
        <button className="danger" onClick={onRemoveAll}>删除整组（清理连接）</button>
      </div>

      <div className="connections">
        <div className="section-title">
          <span>组成员</span>
          <small>可单独改名 / 移除</small>
        </div>
        {members.map((n) => (
          <div className="member" key={n.id}>
            <button className="member-ico" title="只编辑此设备（收起组面板）" onClick={() => onFocus(n.id)}>
              <i className={n.type}>{iconOf(n.type)}</i>
            </button>
            <input
              value={n.name}
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => onRenameLive(n.id, e.target.value)}
              onBlur={onRenameCommit}
            />
            <button className="link-x" title="从组中移除：删除设备并清理连接" onClick={() => onRemove(n.id)}>×</button>
          </div>
        ))}
        <p className="link-note">改名仅作用于单个成员；× 移除会同时清掉它的连接。</p>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);

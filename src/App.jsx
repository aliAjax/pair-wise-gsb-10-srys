import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadTopology, saveTopology } from './state/persistence';
import { useHistory } from './state/useHistory';
import * as sel from './state/selection';
import { NODE_W, NODE_H, normRect, nodesInRect, findBlocked, align, distribute } from './state/layout';

const seed = {
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

const ICONS = { router: '◉', switch: '▦', server: '▣', device: '▱' };
const TYPES = [
  ['router', '◉', '路由器'],
  ['switch', '▦', '交换机'],
  ['server', '▣', '服务器'],
  ['device', '▱', '终端设备'],
];
const ALIGN_BTNS = [
  ['left', '⇤', '左对齐'],
  ['centerX', '↔', '水平居中'],
  ['right', '⇥', '右对齐'],
  ['top', '⤒', '顶对齐'],
  ['centerY', '↕', '垂直居中'],
  ['bottom', '⤓', '底对齐'],
];

export default function App() {
  const { present: data, commit, pushPast, setLive, undo, canUndo } = useHistory(() => loadTopology(seed));
  const [selected, setSelected] = useState(['gw']);
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(null); // {ids, origin, startX, startY, pos, blocked, moved, collapseTo}
  const [marquee, setMarquee] = useState(null); // {x0,y0,x1,y1,additive,base}
  const board = useRef();
  const editSnap = useRef(null);

  useEffect(() => saveTopology(data), [data]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  // 拖动中的临时位置只存在于 drag 状态，提交或退回前不写入数据
  const effNodes = useMemo(
    () => data.nodes.map((n) => (drag?.pos?.[n.id] ? { ...n, ...drag.pos[n.id] } : n)),
    [data, drag]
  );
  const primary = selected[selected.length - 1];
  const node = data.nodes.find((n) => n.id === primary);

  /* ---------- 撤销 ---------- */
  const doUndo = () => {
    const prev = undo();
    if (prev) {
      setSelected((s) => sel.prune(s, prev.nodes));
      setNotice('已撤销');
    }
  };

  /* ---------- 数据动作（每个动作一次 commit = 一次撤销） ---------- */
  const addNode = (type = 'device', label = '新设备') => {
    const id = 'node' + Date.now();
    commit({ ...data, nodes: [...data.nodes, { id, name: label, type, x: 500, y: 300, ip: '192.168.0.10' }] });
    setSelected([id]);
    setTool('select');
    setNotice('已添加设备');
  };

  const connect = () => {
    if (!node) return setNotice('请先选择一台设备');
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (
      other &&
      data.nodes.some((n) => n.id === other) &&
      other !== node.id &&
      !data.edges.some((e) => (e[0] === node.id && e[1] === other) || (e[1] === node.id && e[0] === other))
    ) {
      commit({ ...data, edges: [...data.edges, [node.id, other]] });
      setNotice('连接已创建');
    }
  };

  const removeOne = (id) => {
    commit({
      nodes: data.nodes.filter((n) => n.id !== id),
      edges: data.edges.filter((e) => !e.includes(id)),
    });
    setSelected((s) => s.filter((x) => x !== id));
    setNotice('设备已删除，连接已清理');
  };

  const removeSelected = () => {
    if (!selected.length) return;
    const gone = new Set(selected);
    commit({
      nodes: data.nodes.filter((n) => !gone.has(n.id)),
      edges: data.edges.filter((e) => !gone.has(e[0]) && !gone.has(e[1])),
    });
    setSelected([]);
    setNotice(`已删除 ${gone.size} 台设备及其连接`);
  };

  const doAlign = (mode) => {
    if (selected.length < 2) return;
    commit({ ...data, nodes: align(data.nodes, selected, mode) });
    setNotice('已对齐所选设备');
  };

  const doDistribute = (axis) => {
    if (selected.length < 3) return setNotice('等距排布至少选择 3 台设备');
    commit({ ...data, nodes: distribute(data.nodes, selected, axis) });
    setNotice('已等距排布');
  };

  /* ---------- 属性编辑：聚焦时登记快照，失焦一次性入撤销栈 ---------- */
  const beginEdit = () => (editSnap.current = data);
  const endEdit = () => {
    if (editSnap.current && editSnap.current !== data) pushPast(editSnap.current);
    editSnap.current = null;
  };
  const updateNode = (id, k, v) => setLive({ ...data, nodes: data.nodes.map((n) => (n.id === id ? { ...n, [k]: v } : n)) });
  const changeType = (id, v) => commit({ ...data, nodes: data.nodes.map((n) => (n.id === id ? { ...n, type: v } : n)) });

  /* ---------- 画布交互 ---------- */
  const boardRect = () => board.current.getBoundingClientRect();

  const nodeMouseDown = (e, n) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey) return setSelected((s) => sel.toggle(s, n.id)); // Shift 点选，不进入拖动
    const inSel = selected.includes(n.id);
    const ids = inSel ? selected : [n.id];
    if (!inSel) setSelected(ids);
    const r = boardRect();
    setDrag({
      ids,
      origin: Object.fromEntries(data.nodes.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }])),
      startX: e.clientX - r.left,
      startY: e.clientY - r.top,
      pos: null,
      blocked: new Set(),
      moved: false,
      collapseTo: inSel && selected.length > 1 ? n.id : null, // 组内单击未拖动 → 收起为单选
    });
  };

  const canvasMouseDown = (e) => {
    if (e.button !== 0) return;
    const r = boardRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    setMarquee({ x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey, base: e.shiftKey ? selected : [] });
  };

  const canvasMouseMove = (e) => {
    if (!drag && !marquee) return;
    const r = boardRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (drag) {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      const pos = {};
      for (const id of drag.ids) {
        const o = drag.origin[id];
        pos[id] = { x: o.x + dx, y: o.y + dy }; // 整组保持相对位置
      }
      setDrag({
        ...drag,
        pos,
        moved: drag.moved || Math.abs(dx) + Math.abs(dy) > 3,
        blocked: findBlocked(data.nodes, pos, { width: r.width, height: r.height }),
      });
    } else if (marquee) {
      setMarquee({ ...marquee, x1: x, y1: y });
    }
  };

  const canvasMouseUp = () => {
    if (drag) {
      if (drag.moved) {
        if (drag.blocked.size) {
          // 数据从未写入临时位置，丢弃 drag 即整组退回
          setNotice(
            drag.ids.length > 1
              ? `整组已退回：${drag.blocked.size} 台设备越界或撞到未选设备`
              : '已退回：设备越界或撞到其他设备'
          );
        } else {
          commit({ ...data, nodes: data.nodes.map((n) => (drag.pos[n.id] ? { ...n, ...drag.pos[n.id] } : n)) });
          setNotice(drag.ids.length > 1 ? `已整组移动 ${drag.ids.length} 台设备` : '已移动设备');
        }
      } else if (drag.collapseTo) {
        setSelected([drag.collapseTo]);
      }
      setDrag(null);
    }
    if (marquee) {
      const rect = normRect(marquee);
      if (rect.right - rect.left < 4 && rect.bottom - rect.top < 4) {
        if (!marquee.additive) setSelected(sel.clear());
      } else {
        const ids = nodesInRect(data.nodes, rect);
        setSelected(marquee.additive ? sel.union(marquee.base, ids) : ids);
        if (ids.length) setNotice(`已框选 ${ids.length} 台设备`);
      }
      setMarquee(null);
    }
  };

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        doUndo();
      } else if (e.key === 'Escape') {
        setSelected(sel.clear());
        setDrag(null);
        setMarquee(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && selected.length) {
        removeSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------- 其他 ---------- */
  const save = () => {
    saveTopology(data);
    setNotice('拓扑图已保存');
  };
  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    setNotice('JSON 已导出');
  };
  const validate = () => {
    const linked = new Set(data.edges.flat());
    const isolated = data.nodes.filter((n) => !linked.has(n.id));
    setNotice(isolated.length ? `发现 ${isolated.length} 个孤立节点` : '拓扑检查通过：没有孤立节点');
  };

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
            <small>最近保存：刚刚</small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={validate}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button className="save" onClick={save}>
            保存更改
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>
            ↖ 选择
          </button>
          <button
            className={tool === 'connect' ? 'on' : ''}
            onClick={() => {
              setTool('connect');
              connect();
            }}
          >
            ⌁ 连接
          </button>
          <button onClick={() => addNode()}>＋ 设备</button>
          <button onClick={doUndo} disabled={!canUndo} title="Ctrl+Z">
            ↩ 撤销
          </button>
        </div>
        <div className="tool-group">
          <span>对齐</span>
          {ALIGN_BTNS.map(([mode, icon, label]) => (
            <button key={mode} title={label} disabled={selected.length < 2} onClick={() => doAlign(mode)}>
              {icon}
            </button>
          ))}
          <button title="水平等距" disabled={selected.length < 3} onClick={() => doDistribute('x')}>
            ⋯
          </button>
          <button title="垂直等距" disabled={selected.length < 3} onClick={() => doDistribute('y')}>
            ⋮
          </button>
        </div>
        <div className="tool-group zoom">
          <button>−</button>
          <span>100%</span>
          <button>＋</button>
          <button onClick={() => setNotice('画布已居中')}>⌗</button>
        </div>
      </div>

      <div className="workspace">
        <aside className="inventory">
          <div className="section-title">
            <span>设备库</span>
            <small>{data.nodes.length} 个节点</small>
          </div>
          <div className="device-types">
            {TYPES.map(([t, i, l]) => (
              <button onClick={() => addNode(t, l)} key={t}>
                <i className={t}>{i}</i>
                {l}
                <span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head">
            <span>图中节点</span>
            <small>点击选择 · Shift 多选</small>
          </div>
          <div className="node-list">
            {data.nodes.map((n) => (
              <button
                className={selected.includes(n.id) ? 'sel' : ''}
                onClick={(e) => setSelected(e.shiftKey ? sel.toggle(selected, n.id) : sel.only(n.id))}
                key={n.id}
              >
                <i className={n.type}>{ICONS[n.type]}</i>
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
            className="canvas"
            ref={board}
            onMouseDown={canvasMouseDown}
            onMouseMove={canvasMouseMove}
            onMouseUp={canvasMouseUp}
            onMouseLeave={canvasMouseUp}
          >
            {data.edges.map(([a, b], i) => {
              const n1 = effNodes.find((n) => n.id === a);
              const n2 = effNodes.find((n) => n.id === b);
              if (!n1 || !n2) return null;
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <div className="edge" key={i} style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}>
                  <span></span>
                </div>
              );
            })}
            {effNodes.map((n) => (
              <button
                className={
                  'node ' + n.type + (selected.includes(n.id) ? ' picked' : '') + (drag?.blocked?.has(n.id) ? ' blocked' : '')
                }
                style={{ left: n.x - NODE_W / 2, top: n.y - NODE_H / 2 }}
                onMouseDown={(e) => nodeMouseDown(e, n)}
                key={n.id}
              >
                <i>{ICONS[n.type]}</i>
                <strong>{n.name}</strong>
                <small>{n.ip}</small>
              </button>
            ))}
            {marquee && (
              <div
                className="marquee"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
            <div className="legend" onMouseDown={(e) => e.stopPropagation()}>
              <span>
                <i className="router"></i>路由器
              </span>
              <span>
                <i className="switch"></i>交换机
              </span>
              <span>
                <i className="server"></i>服务器
              </span>
            </div>
          </div>
          <div className="canvas-footer">
            <span>
              拖动整组移动 · Shift 点选 / 空白拖拽框选 · Ctrl+Z 撤销 · {data.edges.length} 条连接
            </span>
            <span>已选 {selected.length} 台</span>
          </div>
        </section>

        <aside className="inspector">
          {selected.length > 1 ? (
            <>
              <div className="section-title">
                <span>已选 {selected.length} 台设备</span>
                <small>组操作</small>
              </div>
              <p className="group-hint">拖动任一成员整组移动；越界或撞到未选设备的成员会标红，松手后整组退回。</p>
              <div className="member-list">
                {selected.map((id) => {
                  const m = data.nodes.find((n) => n.id === id);
                  if (!m) return null;
                  return (
                    <div className="member" key={id}>
                      <i className={m.type}>{ICONS[m.type]}</i>
                      <span className="member-info">
                        <strong>{m.name}</strong>
                        <small>{m.ip}</small>
                      </span>
                      <button title="单独编辑" onClick={() => setSelected(sel.only(id))}>
                        ✎
                      </button>
                      <button title="移除（连接一并清除）" className="danger" onClick={() => removeOne(id)}>
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="inspector-actions">
                <button className="danger" onClick={removeSelected}>
                  删除所选（含连接）
                </button>
              </div>
            </>
          ) : node ? (
            <>
              <div className="section-title">
                <span>属性</span>
                <small>{node.type}</small>
              </div>
              <label>
                设备名称
                <input
                  value={node.name}
                  onFocus={beginEdit}
                  onBlur={endEdit}
                  onChange={(e) => updateNode(node.id, 'name', e.target.value)}
                />
              </label>
              <label>
                IP 地址
                <input
                  value={node.ip}
                  onFocus={beginEdit}
                  onBlur={endEdit}
                  onChange={(e) => updateNode(node.id, 'ip', e.target.value)}
                />
              </label>
              <label>
                设备类型
                <select value={node.type} onChange={(e) => changeType(node.id, e.target.value)}>
                  <option value="router">路由器</option>
                  <option value="switch">交换机</option>
                  <option value="server">服务器</option>
                  <option value="device">终端设备</option>
                </select>
              </label>
              <div className="inspector-actions">
                <button onClick={connect}>⌁ 添加连接</button>
                <button className="danger" onClick={() => removeOne(node.id)}>
                  删除设备
                </button>
              </div>
              <div className="connections">
                <div className="section-title">
                  <span>连接</span>
                  <small>{data.edges.filter((e) => e.includes(node.id)).length} 条</small>
                </div>
                {data.edges
                  .filter((e) => e.includes(node.id))
                  .map((e, i) => {
                    const other = data.nodes.find((n) => n.id === (e[0] === node.id ? e[1] : e[0]));
                    return (
                      <div className="connection" key={i}>
                        <span className={'mini ' + other?.type}></span>
                        <strong>{other?.name}</strong>
                        <small>在线</small>
                      </div>
                    );
                  })}
              </div>
            </>
          ) : (
            <p className="group-hint">选择一个设备</p>
          )}
        </aside>
      </div>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

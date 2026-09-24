import { useCallback, useEffect, useRef, useState } from 'react';

// 撤销/恢复：每次"整组动作"提交一次快照（拖动结束、对齐、批量删除……），
// 因此整组移动/对齐按一次撤销即可整体回退。
// 文本输入用 live 直接改文档，失焦或切字段时再 adopt 一次基线（无变化不入栈）。
export function useHistory(init) {
  const [doc, setDocState] = useState(init);
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const baselineRef = useRef(doc);
  const docRef = useRef(doc);
  const [, bump] = useState(0);
  const refresh = useCallback(() => bump((v) => v + 1), []);

  const setDoc = useCallback(
    (updater, { record = true } = {}) => {
      const next =
        typeof updater === 'function' ? updater(docRef.current) : updater;
      const changed = JSON.stringify(next) !== JSON.stringify(docRef.current);
      if (!changed) return; // 无实质变化不入栈、不触发保存
      if (record) {
        pastRef.current.push(baselineRef.current);
        futureRef.current = [];
        baselineRef.current = next;
      }
      docRef.current = next;
      setDocState(next);
      refresh();
    },
    [refresh]
  );

  // 输入过程中实时改文档，但先不产生撤销点；由 commitBaseline 决定是否入栈。
  const live = useCallback(
    (updater) => setDoc(updater, { record: false }),
    [setDoc]
  );

  const commitBaseline = useCallback(() => {
    if (docRef.current !== baselineRef.current) {
      pastRef.current.push(baselineRef.current);
      futureRef.current = [];
      baselineRef.current = docRef.current;
      refresh();
    }
  }, [refresh]);

  const undo = useCallback(() => {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(docRef.current);
    baselineRef.current = prev;
    docRef.current = prev;
    setDocState(prev);
    refresh();
  }, [refresh]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(docRef.current);
    baselineRef.current = next;
    docRef.current = next;
    setDocState(next);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  return {
    doc,
    setDoc,
    live,
    commitBaseline,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}

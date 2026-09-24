import { useCallback, useState } from 'react';

// 撤销历史：一次 commit 对应一个完整动作（整组移动/对齐/删除……），undo 一次恢复
export function useHistory(initial) {
  const [present, setPresent] = useState(initial);
  const [past, setPast] = useState([]);

  const commit = useCallback(
    (next) => {
      setPast((p) => [...p, present]);
      setPresent(next);
    },
    [present]
  );

  // 编辑进行中（如输入框逐字修改）先登记快照，结束时一次性入栈
  const pushPast = useCallback((snapshot) => {
    setPast((p) => [...p, snapshot]);
  }, []);

  const undo = useCallback(() => {
    if (!past.length) return null;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setPresent(prev);
    return prev;
  }, [past]);

  return { present, commit, pushPast, setLive: setPresent, undo, canUndo: past.length > 0 };
}

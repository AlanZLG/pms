// 台账「问题」列展开/收起纯逻辑（从 OpLogsPanel 抽出，便于单元测试）

/** 折叠态显示「展开」提示的最小字符数 */
export const PROBLEM_HINT_MIN_CHARS = 120

/** 不可变切换：id 已在集合中则移除（收起），否则加入（展开），返回新 Set */
export function toggleExpanded(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 折叠态且内容超过阈值时显示「展开」提示 */
export function showExpandHint(problem: string | undefined | null, expanded: boolean): boolean {
  return !expanded && (problem?.length ?? 0) > PROBLEM_HINT_MIN_CHARS
}

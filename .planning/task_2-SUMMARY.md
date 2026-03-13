# task_2: Allow session queries when source is claude or all; propagat

Assignee: coder
Status: done

## Result
御坂完成了任务，概要如下。

## 结论
- 会话检索已支持 source=all/claude/codex，查询（含 claude code 变体）会随 API 请求发送，输入框不再被错误禁用并提供关键词提示。

## 行动项
- 运行单元测试验证：`node tests/unit/run.mjs`
- 前端自查：在 Web UI 选择 source=all，搜索“claude code”，确认请求 payload 携带 query 且输入框可用。

## 改动
- `tests/unit/web-ui-logic.test.mjs`: 更新会话检索启用范围与参数保留的单测。
- `web-ui/logic.mjs`: 扩展会话查询启用源到 all/claude/codex，并保留查询传递。
- `web-ui/app.js`: 占位符提示支持 Claude/Codex 检索及 “claude code” 示例，未支持来源继续显示禁用提示。

## 验证
- `node tests/unit/run.mjs`（通过）

## 风险/后续
- 风险判定：0
- 证据链：已归零
- 不确定项：无
- 建议：在允许的环境手动走一遍 UI 查询，确保后端返回包含 provider/capabilities/keywords。

## AWSL_RESULT
- 实现：Web 会话查询允许 all/claude 源携带查询（含 claude code），占位符提示更新。
- 变更文件：`web-ui/logic.mjs`; `web-ui/app.js`; `tests/unit/web-ui-logic.test.mjs`
- 测试：`node tests/unit/run.mjs` ✅
- 共享记忆：`C:\Users\Ymkiux\.codex\memories\result-coder-task_2.txt`

report: C:\Users\Ymkiux\.codex\memories\result-coder-task_2.txt

御坂报告完毕。
# Execution Plan

## task_1: 完善搜索 e2e 场景
- **Assignee:** coder
- **Files:** tests/e2e/conversation_search.spec.ts

### Action
在 conversation_search.spec.ts 中新增覆盖“claude code”关键词的会话浏览搜索用例，断言结果列表含预期会话并校验高亮/分页等行为；保持现有测试风格与选择器。

### Verify
npm run test:e2e -- tests/e2e/conversation_search.spec.ts

### Done
新增的“claude code”搜索用例能独立通过并与现有用例共存

## task_2: 补充 e2e 固件数据
- **Assignee:** coder
- **Files:** tests/fixtures/conversations.json

### Action
在 conversations.json 中加入含关键词“claude code”的会话记录（含必要字段如标题/内容/时间戳/ID），确保数据被 e2e 种子或 mock 服务加载，避免破坏既有数据顺序。

### Verify
npm run test:e2e -- tests/e2e/conversation_search.spec.ts

### Done
fixture 加入新会话且被搜索用例成功检索

## task_3: 运行回归验证
- **Assignee:** tester
- **Dependencies:** task_1, task_2
- **Files:** tests/e2e

### Action
在更新完成后运行完整 e2e 套件，记录结果；若有波动失败，收集日志并反馈。

### Verify
npm run test:e2e

### Done
全量 e2e 测试通过，无新增失败

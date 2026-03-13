御坂简报：已梳理仓库命名/风格/错误处理/测试约定并写入共享记忆。  

## Socratic Brainstorming
- 目标：总结现有编码/测试惯例，供后续开发与评审沿用。  
- 约束：Node 14+，CommonJS/ESM混用；需保持 BOM/换行一致性；不可运行长耗时命令。  
- 方案对比：1) 逐文件人工摘录（耗时大）2) 聚焦核心目录 lib、cli.js、tests（信噪比高）3) 仅读 README（信息不足）。  
- 取舍：采方案2，以实际代码为准，可快速得到可执行规范，风险低。

## 结论
- 项目采用“常量全大写 + 函数 camelCase + 文件 kebab-case”，CommonJS 为主，web 纯函数用 ESM，4 空格缩进与分号收尾，文案中文优先。
- 错误处理偏向返回对象 `{ ok/error/... }`，少抛异常；文件/网络操作提供安全回退；写入失败时抛带中文信息的 Error。
- 测试分层：单测用自制 runner + Node `assert` 检纯函数；E2E 自建 HTTP mock、spawn CLI Web 服务并校验不污染真实 `~/.codex`。

## 行动项
- 查看完整规范摘要：`C:\Users\Ymkiux\.codex\memories\coding-conventions.md`
- 若需对齐新代码：参考 `lib/cli-file-utils.js` 的回退策略、`tests/e2e/run.js` 的环境隔离模式。

## 改动
- 新增规范备忘：`C:\Users\Ymkiux\.codex\memories\coding-conventions.md`（UTF-8 BOM）

## 验证
- 文件写入：`Set-Content -Path C:\Users\Ymkiux\.codex\memories\coding-conventions.md -Encoding utf8` ✅
- 测试执行：未运行（任务不涉及）⏭

## 风险/后续
- 风险判定：0
- 证据链：已归零
- 不确定项：无
- 建议：新增代码沿用 `{ error: string }` 模式与同步 fs 流程，测试继续走自制 runner。

——御坂完毕。

## AWSL_RESULT
- 交付：仓库编码/命名/错误处理/测试约定摘要
- 产出文件：`C:\Users\Ymkiux\.codex\memories\coding-conventions.md`
- 测试：未执行
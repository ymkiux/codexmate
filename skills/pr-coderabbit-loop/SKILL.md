---
name: pr-coderabbit-loop
description: Run iterative CodeRabbit PR review loops without stopping; handle rate limits, non-author commits, re-review comments, commit message format, and required @coderabbitai prompts. Use when working on PRs reviewed by CodeRabbit that need multiple fix-review cycles.
---

# CodeRabbit PR 循环助手

面向场景：需要与 @coderabbitai 反复交互的 PR，避免“一轮就停”的风险，直到连续无新建议或获 LGTM。

## 快速起步
1. 确认当前分支是 PR 分支，工作区干净。
2. 拉取最新：`git pull`.
3. 核心循环按「执行循环」节。

## 执行循环（不得跳过）
1. **扫描状态**
   - 查最新 commit 作者：`git log -1 --pretty=format:'%H %an <%ae>'`.
   - 拉取评论：`gh pr view <num> --json comments,latestReviews`.
2. **非作者 commit 处理**
   - 如果最新 commit 作者 ≠ PR 作者/仓库 owner：不做修复，仅输出提示“检测到非作者 commit，可能已自动触发 review，继续监控最新评论……”。
3. **处理建议（作者 commit 或有新评论时）**
   - 逐条落实 @coderabbitai 新/未解决建议，禁止 breaking changes/接口变更。
   - 改动后跑必要测试（如 `npm test`），确保通过。
   - 提交信息格式：`fix(coderabbit): respond to suggestion - <简述>`。
   - 推送：`git push`.
   - 立即评论：`@coderabbitai re-review ！Stop making breaking changes, do a proper review！`
4. **等待与轮询**
   - 若被 rate limit：按照提示等待（示例“wait 13 minutes 43 seconds”），期间不重复请求。
   - 进入主动轮询：每 2–3 分钟重新执行“扫描状态”，输出“检查中... 第 N 次 | 轮次 Z”。
   - 连续 4–5 次无新评论后，再次发送 `@coderabbitai re-review…` 作为确认。
5. **结束判定（全部满足才停止）**
   - 连续两轮无任何新建议，且最后一次 re-review 后仍无评论 / 明确 LGTM。
6. **额外安全阀**
   - 多次出现非作者 commit → 警告“可能 PR 被他人接管，手动确认 CodeRabbit 状态”。

## 文字模板
- 必发评论：`@coderabbitai re-review ！Stop making breaking changes, do a proper review！`
- 进度广播：`检查中... 第 N 次 | 轮次 Z`

## 常用命令
- 查看状态：`git status -sb`
- 运行测试：`npm test`
- 查看 PR 评论：`gh pr view <num> --json comments,latestReviews`
- 提交：`git commit -m "fix(coderabbit): respond to suggestion - <desc>"`

## 注意
- 只做最小变更，保持行为兼容。
- 发现 Rate Limit 时不要刷评论；等待时间结束再重新 @coderabbitai。
- 每 2 轮输出一次进度 + 质量自评，保持可追踪性。

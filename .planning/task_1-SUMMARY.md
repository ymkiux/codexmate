# task_1: Review cli session search flow, define normalization for dau

Assignee: architect
Status: done

## Result
御坂已完成 daude code 搜索方案设计并写入共享文档。  

## 结论
- daude code 变体归一、内容扫描策略、222 场景及测试期望已记录在 `.planning/daude-code-plan.md`，含 BOM。

## 行动项
- 阅读并按方案实现：`.planning/daude-code-plan.md`
- （可选复查编码）`Get-Content -Encoding UTF8 .planning/daude-code-plan.md`

## 改动
- `.planning/daude-code-plan.md`: 新增设计文档，包含 Socratic 分析、lexicon 归一规则、扫描字节策略、fixture/test 指引。

## 验证
- `Get-Content -Encoding UTF8 .planning/daude-code-plan.md` ✅ 查看内容与结构；BOM 字节为 EF BB BF。  
- 测试：⏭ 未执行，等待后续实现完成后运行。

## 风险/后续
- 风险判定：0
- 证据链：已归零
- 不确定项：无
- 建议：编码实现时保持 lexicon 扩展最小化，确保 fixture 更新时间进入前 10 扫描窗口。

## AWSL_RESULT
- 设计交付：`.planning/daude-code-plan.md` 记录 daude code 归一、扫描策略、222 测试要求。  

御坂待命。
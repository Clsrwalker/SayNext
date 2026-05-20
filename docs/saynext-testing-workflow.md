# SayNext Testing Workflow

目标：把 SayNext 的测试流程从“看到 bad 就加 patch”改成稳定的过程闭环。

核心原则：

- `regression` = 已确认必须修，作为 hard gate。
- `candidate` = 待判断，只记录，不自动失败。
- `random stress` = 发现器，不是裁判。
- `LLM judge` = 辅助信号，不是唯一真相。
- patch 只修错误类别，不修单句现象。

## 1. 日常快速门禁

每次改 process、route、rule、prompt patch、postprocess 后，先跑无 LLM 快速门禁：

```powershell
bun test src/server/test/saynext-output-format.test.ts src/server/test/personal-memory-retrieval.test.ts
bun scripts/eval-process-cases.ts
bun scripts/eval-process-rule-conflicts.ts data/eval/process-regression-cases.jsonl --fail-on-mismatch --fail-on-conflict
bun x tsc --noEmit
```

这一层不用 LLM，主要防止：

- 老 bug 回来。
- route 被新 rule 抢走。
- process contract 断掉。
- 新 rule 误触发。
- postprocess patch 影响无关场景。

如果这一层失败，优先看失败类型：

- `expected_route` 不匹配：先查 router priority 和 negative patterns。
- `forbidden_rules` 命中：通常是 over-trigger，先收窄旧 rule。
- `gold_process_contract` 缺失：route 可能错了，或 contract 定义不完整。
- `must_include` 缺失：先确认 route 正确，再判断 generator/process 是否要改。

## 2. 随机/LLM 压力测试

压力测试用来发现新问题，不作为 hard gate。

常用命令：

```powershell
bun scripts/eval-llm-simulated-conversations.ts --random=30 --turns=2 --distribution=chaos --asr-rate=0.65
```

如果要更接近日常分布：

```powershell
bun scripts/eval-llm-simulated-conversations.ts --random=30 --turns=2 --distribution=realistic --asr-rate=0.35
```

如果要专门压 ASR 噪声：

```powershell
bun scripts/eval-llm-simulated-conversations.ts --random=50 --turns=2 --distribution=chaos --asr-rate=0.8 --asr-severity=heavy
```

压力测试产出的 `process_bad` 会追加到：

```text
data/eval/process-candidates.jsonl
```

这些只是候选问题：

- 不自动失败。
- 不立刻 patch。
- 不直接进入 regression。
- 必须经过复审和标注。

## 3. 候选复审和入库

打开候选文件：

```text
data/eval/process-candidates.jsonl
```

每条 candidate 先分四类。

## A. 真 process failure，且是重复类别

例子：

- 技术问题答太浅。
- 当前问题被旧上下文抢走。
- 多意图只回答一半。
- 风险模板吞掉 API/debug 任务。
- public/background transcript 插入 Xiang 个人信息。

处理方式：

1. promote 到 `process-regression-cases.jsonl`。
2. 补 `expected_route`、`gold_process_contract`、`must_include`、`forbidden_rules`。
3. 修 route/rule/process contract。
4. 跑日常快速门禁。

## B. 旧 rule 过宽导致误触发

例子：

- `right now` 被当成法律 `rights`。
- `API contract` 被当成法律 contract。
- `career checklist` 被 car/service checklist 抢走。

处理方式：

1. 不加新 patch。
2. 收窄旧 rule。
3. 增加 negative pattern。
4. 加 regression 负例。
5. 跑 conflict detector。

## C. evaluator false positive

例子：

- 安全提醒里说 `do not share password`，却被 naive `password` reject 打成 bad。
- 低风险 casual answer 被套了技术深度标准。
- 有 grounded memory，却被 judge 当成过度个性化。

处理方式：

1. 修 evaluator 或分类逻辑。
2. 不改产品输出。
3. 不加 postprocess patch。

## D. 单次随机质量问题

例子：

- 某次随机组合导致回答一般，但没有重复类别。
- 表达不够自然，但 process 没错。
- judge 主观不喜欢某种语气。

处理方式：

- 保留观察。
- 不入 regression。
- 不改 production rule。
- 等累计 3 到 5 个同类后再考虑。

## 4. Regression Case 格式

确认是 A/B 后，把 candidate 整理进：

```text
data/eval/process-regression-cases.jsonl
```

最小例子：

```json
{
  "id": "tech_debug_api_403_001",
  "taxonomy": "technical_depth_low",
  "input": "How should I debug this API 403 issue?",
  "saynext_output": "I would check the request, response status, auth, route, payload, and logs first.",
  "expected_route": "tech_debug",
  "gold_process_contract": ["state the likely failing boundary", "name the next concrete inspection"],
  "must_include_any": ["logs", "request", "response", "status"],
  "forbidden_rules": ["route:high-risk-boundary"]
}
```

常用字段：

- `id`: 稳定唯一 ID。
- `taxonomy`: 错误类别。
- `input`: 最新 transcript。
- `saynext_output`: 当时输出或期望验证输出。
- `expected_route`: 期望 route。
- `gold_process_contract`: 过程必须满足的 contract。
- `must_include_all`: 输出必须全部包含。
- `must_include_any`: 输出至少包含一个。
- `must_not_include` / `reject_any`: 输出禁止包含。
- `forbidden_rules`: 不应该触发的 route/rule。
- `expected_risk_level`: 期望风险等级。
- `expected_should_use_old_context`: 是否允许旧上下文参与。

## 5. Patch 入库门槛

新增 patch 必须满足：

1. 修一个错误类别，不是修一句具体怪话。
2. 有正例测试：应该触发。
3. 有负例测试：相似输入不应该触发。
4. 不抢其他 route。
5. 能通过 conflict detector。
6. 如果影响 high-risk 或 technical route，要加 adversarial case。

不好的 patch：

```text
如果输出里出现某句具体奇怪的话，就替换成另一句。
```

好的 patch：

```text
凡是 public speaker-labelled transcript，且 Xiang 没有被直接问到，就不要插入 Xiang 的个人项目、学校、身份。
```

## 6. 推荐执行顺序

普通改动：

```text
edit code
run daily fast gate
if pass, stop
```

发现新 bad：

```text
run random stress
inspect process-candidates.jsonl
classify A/B/C/D
only promote A/B
add regression case
fix route/rule/evaluator
run daily fast gate
```

修改 route/rule：

```text
edit PROCESS_RULES
run eval-process-rule-conflicts
run eval-process-cases
run unit tests
run tsc
```

修改 output postprocess：

```text
add focused unit test
run saynext-output-format.test.ts
run process regression
run tsc
```

## 7. 当前相关文件

Process core:

- `src/server/saynext/process-router.ts`
- `src/server/saynext/output-postprocess.ts`
- `src/server/mastra/agents/initial-agent.ts`

Deterministic tests:

- `src/server/test/saynext-output-format.test.ts`
- `src/server/test/personal-memory-retrieval.test.ts`
- `scripts/eval-process-cases.ts`
- `scripts/eval-process-rule-conflicts.ts`

LLM/random discovery:

- `scripts/eval-llm-simulated-conversations.ts`
- `scripts/eval-random-scenario-banks.ts`

Case files:

- `data/eval/process-candidates.jsonl`
- `data/eval/process-regression-cases.jsonl`

## 8. 测试文件使用方法

### `data/eval/process-regression-cases.jsonl`

用途：保存已经确认必须防回归的 process case。这里的 case 是 hard gate。

使用规则：

- 一行一个 JSON object。
- 不要写成 JSON array。
- 行尾不要加逗号。
- 每条必须有稳定 `id`。
- 每条必须至少有一个明确 gate，例如 `expected_route`、`gold_process_contract`、`must_include_any` 或 `forbidden_rules`。
- 只有 A/B 类问题进入这里：真实 process failure，或旧 rule 过宽导致误触发。

推荐新增流程：

```text
copy candidate
rewrite id/taxonomy/input/output
add expected_route
add gold_process_contract
add must_include / must_include_any
add forbidden_rules when needed
run eval-process-cases
run eval-process-rule-conflicts
```

运行 regression cases：

```powershell
bun scripts/eval-process-cases.ts
```

指定文件运行：

```powershell
bun scripts/eval-process-cases.ts data/eval/process-regression-cases.jsonl
bun scripts/eval-process-cases.ts --file=data/eval/process-regression-cases.jsonl
```

更严格运行：

```powershell
bun scripts/eval-process-cases.ts --fail-on-needs-label --fail-on-snapshot-drift
```

结果解释：

- `pass`: 当前 route、contract、output gates 都满足。
- `fail`: 必须修。
- `needs_label`: 这条 case 还没有明确 gate，不能作为 regression。
- `snapshot drift`: 记录中的旧 route 和当前 route 不一致；默认只是提示，加 `--fail-on-snapshot-drift` 才会失败。

### `data/eval/process-candidates.jsonl`

用途：保存随机/LLM 压力测试发现的候选 bad。这里不是 hard gate。

来源：

```powershell
bun scripts/eval-llm-simulated-conversations.ts --random=30 --turns=2 --distribution=chaos --asr-rate=0.65
```

脚本会把 `process_bad` 追加到：

```text
data/eval/process-candidates.jsonl
```

使用规则：

- 不要直接把全部 candidate 当成失败。
- 不要因为一条 candidate 立刻 patch。
- 先人工复审，分成 A/B/C/D。
- 只有 A/B 才整理进 `process-regression-cases.jsonl`。
- C 修 evaluator，不修产品。
- D 保留观察。

复审时重点看：

- `input`: 当前 transcript 是否真的在问 SayNext。
- `saynext_output` / `output`: 输出是流程错，还是只是质量一般。
- `processTrace.route`: 是否走错 route。
- `processTrace.rulesFired`: 是否有旧 rule 误触发。
- `judge` / `reviewReason`: 只能当辅助线索，不当最终裁判。

### `scripts/eval-process-cases.ts`

用途：验证 regression case 的 route、contract、risk、context、输出关键词和禁用规则。

常用命令：

```powershell
bun scripts/eval-process-cases.ts
bun scripts/eval-process-cases.ts data/eval/process-regression-cases.jsonl
bun scripts/eval-process-cases.ts --file=data/eval/process-regression-cases.jsonl
```

支持的常用字段：

- `input` / `transcript`: 当前用户或对方说的话。
- `saynext_output` / `output`: 要检查的 SayNext 输出。
- `expected_route`: 当前输入应该走的 route。
- `expected_taxonomy`: 期望错误分类。
- `expected_risk_level`: 期望风险等级。
- `expected_should_use_old_context`: 是否允许旧上下文。
- `required_rules` / `expected_rules`: 必须触发的 rule。
- `forbidden_rules`: 禁止触发的 rule。
- `gold_process_contract` / `expected_contract`: 必须满足的流程 contract。
- `must_include` / `must_include_all`: 输出必须全部包含。
- `must_include_any`: 输出至少包含一个。
- `must_not_include` / `reject_any`: 输出禁止包含。

适合检查的问题：

- route 有没有走错。
- high-risk 模板有没有误伤普通问题。
- technical 问题有没有缺最小流程元素。
- memory/context 是否不该参与却参与了。
- 输出是否漏掉 process 必须元素。

### `scripts/eval-process-rule-conflicts.ts`

用途：检查 route/rule 是否互相抢。

常用命令：

```powershell
bun scripts/eval-process-rule-conflicts.ts
bun scripts/eval-process-rule-conflicts.ts data/eval/process-regression-cases.jsonl --fail-on-mismatch --fail-on-conflict
```

它会读取每条 case 的 `input` 或 `transcript`，只看 routing，不看自然语言质量。

结果解释：

- `conflict`: 多个 route/rule 同时强匹配，而且不是预期的 composite route。
- `mismatch`: 当前 top route 和 `expected_route` 不一致。

修法优先级：

1. 先收窄误触发 rule 的 positive pattern。
2. 再加 negative pattern。
3. 再调整 priority。
4. 最后才考虑新增 rule。

不要用 output postprocess 去修 route conflict。

### `src/server/test/saynext-output-format.test.ts`

用途：测试 output postprocess、快速分支、路由兼容导出和格式清洗。

适合新增的测试：

- 新增 postprocess helper。
- 修改 `finalizeSayNextOutput`。
- 修改 `sanitizeSayNextOutput`。
- 修改 speaker-labelled transcript 处理。
- 修改 immediate rule 输出格式。

运行：

```powershell
bun test src/server/test/saynext-output-format.test.ts
```

### `src/server/test/personal-memory-retrieval.test.ts`

用途：防止 memory retrieval 和个人信息使用边界回归。

适合新增的测试：

- shouldUseMemory 的场景。
- shouldAvoidPersonal 的场景。
- 一般问题不该硬塞个人经历。
- public/background transcript 不该暴露个人项目、学校、身份。

运行：

```powershell
bun test src/server/test/personal-memory-retrieval.test.ts
```

### 新 case 应该放哪里

快速判断：

| 情况 | 放哪里 |
| --- | --- |
| 已确认必须修的 process failure | `process-regression-cases.jsonl` |
| 随机压力测试刚发现，没复审 | `process-candidates.jsonl` |
| output 清洗或格式问题 | `saynext-output-format.test.ts` |
| memory 使用边界问题 | `personal-memory-retrieval.test.ts` |
| route/rule 抢占问题 | `process-regression-cases.jsonl` + conflict test |
| evaluator 误判 | evaluator 测试或脚本逻辑，不改产品 case |

### 从 candidate promote 到 regression 的模板

把 candidate 改成这种形态：

```json
{"id":"route_right_now_not_legal_001","taxonomy":"over_trigger","input":"Right now, what should I say to the recruiter about my career direction?","saynext_output":"I would give a short career pitch focused on full-stack, AI, and cloud work, then ask what the next step is.","expected_route":"career_pitch","gold_process_contract":["frame experience toward target role","keep it concise and interview-safe"],"must_include_any":["career","full-stack","AI","cloud","next step"],"forbidden_rules":["route:risk_boundary"]}
```

检查它：

```powershell
bun scripts/eval-process-cases.ts data/eval/process-regression-cases.jsonl
bun scripts/eval-process-rule-conflicts.ts data/eval/process-regression-cases.jsonl --fail-on-mismatch --fail-on-conflict
```

如果这两条都过，再跑完整快速门禁。

## 9. What Not To Do

Do not:

- Treat every LLM judge bad as product failure.
- Add a patch for every random bad.
- Use random stress as a CI gate.
- Let evaluator false positives reshape product output.
- Make SayNext more conservative just to avoid bad labels.
- Apply technical-depth standards to casual topics.
- Apply legal/medical/financial risk templates to low-risk normal questions.

The correct goal is process stability, not maximizing one noisy aggregate score.

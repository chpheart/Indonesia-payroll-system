# 变更记录

## [v1.1] - 2026-06-15

### 新增

- 新增 Agent 工具契约要求，明确每个工具必须包含输入 schema、输出 schema、错误码、权限级别、幂等性、重试策略和超时阈值。
- 新增 Agent golden eval 体系，要求蓝色光标和三福真实案例拆分为 Excel 结构识别、字段映射、员工匹配、追问、证据关联、阻断/高风险分类、核查解释等评估维度。
- 新增 Agent guardrails 与安全要求，明确客户 Excel、截图 OCR、企业微信文本和 RAG 文档只能作为数据，不能作为系统指令。
- 新增 Agent 版本治理对象：AgentRun、AgentStep、ToolInvocation、PromptVersion、ModelVersion、RetrievalIndexVersion、ToolSchemaVersion、GuardrailResult、EvalDataset、EvalCase、EvalRun、AgentOutputReview。
- 新增 `12. Agent 工程化与治理验收`，定义 Agent 发布门禁、golden eval set、发布状态、观测指标和事故处理规则。
- 新增 Agent 相关完成定义：prompt/model/RAG/tool schema/guardrail 配置必须版本化、追溯和通过 critical eval。

### 修改

- 将原 `REQ-015: Agent 能力、资料库、Trace 与记忆` 拆分为 `REQ-015A` 至 `REQ-015D`，分别覆盖 Agent 编排与工具契约、Agent Eval、Agent Guardrails、Agent Trace/版本治理/资料库/记忆。
- 修改 `SCOPE-013` 周边范围，补充 `SCOPE-013A Agent 工具契约、Eval、Guardrails 和版本治理`。
- 修改外部依赖，新增 Agent eval/observability 能力作为 P0 依赖。
- 修改非功能需求，新增 AI 治理要求：Agent 相关变更必须版本化并通过 golden eval。
- 修改待确认问题 Q-004，从“是否需要 Agent 质量条固定准确率”调整为“非 critical 指标上线阈值是否需要固定”。

---

## [v1.0] - 2026-06-15

- 初始版本。

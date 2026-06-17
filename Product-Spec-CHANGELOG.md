# 变更记录

## [v1.2] - 2026-06-17

### 新增

- 新增产品定位原则：内部优先的 AI-native EOR / Payroll Ops System，明确“企业微信是入口，AI 是整理和调度层，ledger 是事实源，workflow 是责任边界”。
- 新增 AI Intake Inbox 范围、流程和需求，支持企业微信文本/截图、Excel、合同、客户确认和内部备注进入 RawInputItem 队列。
- 新增 ChangeProposal / ChangeLedger 需求，明确 AI 抽取结果必须先成为 proposal，经人工审核后才能写入正式变更 ledger。
- 新增 Customer Confirmation Pack 需求，要求按 payroll run 汇总本月变更、缺失信息、异常项、需确认事项和建议话术，并绑定客户回复证据和覆盖范围。
- 新增 RawInputItem、ChangeProposal、ChangeLedgerEntry、CustomerConfirmationPack、CaseItem 等核心实体及其关系。
- 新增 Intake 分类、变更抽取、客户确认包生成等 Agent workflow node、AI 能力规格和 golden eval 维度。

### 修改

- 修改 Payroll Run 端到端流程，加入 raw input -> AI extraction -> proposed change -> human review -> confirmed ledger -> payroll run 链路。
- 修改证据关联范围，补充 RawInputItem、ChangeProposal、ChangeLedgerEntry 和 CustomerConfirmationPack。
- 修改 MVP 完成定义，加入 AI Intake、ChangeProposal/ChangeLedger 和 Customer Confirmation Pack 的可追溯验收。
- 修改 Agent 系统规格，补充 intake、proposal、客户确认包的自主性边界、工具能力、上下文记忆和质量观测指标。

---

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

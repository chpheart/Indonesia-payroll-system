# Development Plan — 印尼 Payroll Agent V1

> 本文件记录项目的开发阶段划分、当前进度和剩余工作。
> 新 session 启动时应首先阅读 `Product-Spec.md`、`Product-Spec-CHANGELOG.md` 和本文件，再继续开发。

---

## 当前状态

- Product Spec：已完成，来源为 `Product-Spec.md`
- Design Brief：未创建；V1 先按内部运营系统设计，不做营销页或员工端
- 项目代码：尚未创建
- 代码目录：`indonesia-payroll-agent/`
- V1 范围：覆盖完整 P0；P1 只记录为后续范围，不进入本开发计划

---

## 高责任开发门禁

本项目默认按高责任场景开发。薪酬、个税、社保、客户交付、权限、导出、Agent 建议和规则版本相关能力，不能只按普通 CRUD 验收。

### 风险等级

| 风险等级 | 范围 | 默认门禁 |
|---|---|---|
| R0 基础设施 | layout、健康检查、空任务台、本地存储适配层 | 可自动执行，但必须可编译、可回滚 |
| R1 敏感数据读写 | 客户、员工、银行账号、证件号、NPWP、客户授权、证据查看 | 必须 RBAC、脱敏、审计、客户隔离 |
| R2 生效配置 | 字段映射生效、标准化数据生效、员工主档版本、客户配置、规则草稿/发布 | 必须预览差异、人工确认、版本化、审计 |
| R3 高影响业务动作 | 正式算薪、锁定、正式导出、高风险放行、规则发布、作废、correction run | 必须权限校验、确认卡口、阻断复核、trace 完整、回滚或更正路径 |
| R4 外部提交/付款 | 银行付款、政府平台提交、企业微信自动发送 | V1 不实现，只允许归档证据或人工上传 |

### 通用门禁

- 高影响动作 R2+ 必须先产出预览、差异、影响范围和理由，再由有权限角色人工确认。
- 任何影响工资结果、PPh21、BPJS、实发、雇主成本、正式导出和高风险放行的流程都必须 fail closed：证据冲突、规则缺口、权限不明、trace 不完整时阻断。
- 客户 Excel、截图/OCR、企业微信文本、RAG 文档、历史备注和 Agent 输出一律是不可信输入；只能作为数据、候选、解释或证据，不得覆盖系统规则、触发工具调用或绕过审批。
- Agent 不得直接生成生效映射、规则、算薪结果、放行、锁定或正式导出；所有生效动作必须经过确定性系统、权限矩阵和人工确认。
- 审计日志、Agent trace、CalculationTrace、EvalRun、GuardrailResult、导出记录和放行记录不得物理删除；更正只能追加说明或创建 correction run。

---

## Phase 1: 项目骨架 + 基础设施

**交付内容**：
- 搭建 `indonesia-payroll-agent/` Next.js 全栈项目，启用 TypeScript、pnpm、ESLint、Vitest、Playwright。
- 在 `package.json` 固定 `packageManager: "pnpm@11.7.0"`，并设置 Node engine `>=20.9.0`。
- 配置 PostgreSQL 18 本地开发环境和 Prisma 7.8.0。
- 创建内部系统基础 layout、导航壳、空任务台、健康检查接口。
- 建立本地文件存储适配层，后续可切换到 S3 兼容对象存储。

**关键文件**：
- `indonesia-payroll-agent/package.json` — 项目脚本、依赖和 pnpm 配置。
- `indonesia-payroll-agent/docker-compose.yml` — PostgreSQL 18 本地开发数据库。
- `indonesia-payroll-agent/prisma/schema.prisma` — Prisma datasource、generator 和初始空 schema。
- `indonesia-payroll-agent/src/app/(app)/layout.tsx` — 内部系统主布局和导航壳。
- `indonesia-payroll-agent/src/app/(app)/page.tsx` — 空任务台入口。
- `indonesia-payroll-agent/src/app/api/health/route.ts` — 健康检查和数据库连接探针。
- `indonesia-payroll-agent/src/lib/storage/local-file-store.ts` — 本地文件存储适配层。

**验收标准**：
- 在 `indonesia-payroll-agent/` 下执行 `pnpm install`、`pnpm dev` 后可打开空任务台。
- 本机 Node `25.9.0` 满足 Next.js 16.2.9 的 Node `>=20.9.0` 要求。
- `package.json` 包含 `packageManager: "pnpm@11.7.0"` 和 Node engine。
- `pnpm prisma db push` 或首次 migration 可连接本地 PostgreSQL。
- `/api/health` 返回应用和数据库可用状态。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 2: 权限、审计、基础数据模型

**交付内容**：
- 实现用户、角色、客户、客户授权、审计日志、客户配置版本、员工主档、员工主档版本。
- 建立 RBAC：客服/交付专员、算薪人、算薪负责人/交付主管、规则管理员、系统管理员。
- 实现敏感字段脱敏和明文查看审计。
- 创建客户和员工基础管理页面，支持启用、停用、误建删除规则。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 User、Role、Client、ClientAccess、AuditLog、ClientConfigVersion、Employee、EmployeeMasterVersion。
- `indonesia-payroll-agent/src/domain/auth/permissions.ts` — 角色权限矩阵和客户授权判断。
- `indonesia-payroll-agent/src/domain/audit/audit-service.ts` — 审计记录写入和追加更正说明。
- `indonesia-payroll-agent/src/domain/clients/client-service.ts` — 客户启用、停用、配置版本逻辑。
- `indonesia-payroll-agent/src/domain/employees/employee-service.ts` — 员工主档版本、关键字段证据要求、脱敏规则。
- `indonesia-payroll-agent/src/app/(app)/clients/page.tsx` — 客户列表和客户授权入口。
- `indonesia-payroll-agent/src/app/(app)/employees/page.tsx` — 员工查询和主档入口。

**验收标准**：
- 不同角色只能访问授权客户；系统管理员可查看所有客户但不能业务放行。
- 权限矩阵必须拆开查看、下载/导出、编辑、执行计算、生效/审批、配置和审计，不能从“能看”推导“能导出/能放行”。
- 银行账号、证件号、NPWP 默认脱敏；查看明文必须记录审计。
- 有历史数据的客户和员工不能物理删除，只能停用或离职。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 3: Payroll Run 状态机与任务台

**交付内容**：
- 实现 payroll run 创建、负责人、目标完成日期、发薪日、状态机和阶段回退。
- 实现任务台指标：待处理 run、阻断项数量、高风险项数量、待客户确认数量、逾期任务数量。
- 实现 run 详情页，所有上传、映射、追问、预检查、算薪、确认、锁定、导出都从详情页进入。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 PayrollRun、RunStatusEvent、RunAssignment、RunReminder。
- `indonesia-payroll-agent/src/domain/payroll-runs/run-state-machine.ts` — 状态流转、阶段回退和锁定约束。
- `indonesia-payroll-agent/src/domain/payroll-runs/run-service.ts` — run 创建、查询、负责人变更。
- `indonesia-payroll-agent/src/app/api/payroll-runs/route.ts` — payroll run 列表和创建 API。
- `indonesia-payroll-agent/src/app/api/payroll-runs/[runId]/route.ts` — run 详情 API。
- `indonesia-payroll-agent/src/app/(app)/payroll-runs/page.tsx` — 任务台和筛选。
- `indonesia-payroll-agent/src/app/(app)/payroll-runs/[runId]/page.tsx` — run 详情页骨架。

**验收标准**：
- 可创建客户 + 薪资月份 payroll run，并进入 run 详情页。
- 文件、映射、规则、汇率、客户配置变化可触发需重新预检查/需重算状态。
- 任务台筛选客户、月份、状态、负责人、阻断/高风险可用。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 4: 原始 Excel 上传、解析与追溯

**交付内容**：
- 支持 `.xlsx` 和 `.xls` 多文件上传、用途选择、文件版本、替代关系、解析状态。
- 解析 workbook、sheet、有效数据区域、表头、样例值、单元格地址、原始值、显示值、公式文本、合并单元格范围。
- 实现 Excel 解析预览，不允许在线编辑原始 Excel。
- 对加密、损坏、无法解析、缺 sheet、缺表头文件生成阻断项。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 UploadedFileVersion、WorkbookParse、WorkbookSheet、WorkbookCell、FileReplacement。
- `indonesia-payroll-agent/src/domain/files/upload-service.ts` — 文件上传、版本、用途和替代关系。
- `indonesia-payroll-agent/src/domain/excel/excel-parser.ts` — 基于 `xlsx` 解析 `.xls/.xlsx`、公式、合并单元格和有效区域。
- `indonesia-payroll-agent/src/domain/excel/workbook-preview-service.ts` — sheet、表头、样例值预览模型。
- `indonesia-payroll-agent/src/app/api/files/route.ts` — 文件上传 API。
- `indonesia-payroll-agent/src/app/api/files/[fileId]/preview/route.ts` — Excel 预览 API。
- `indonesia-payroll-agent/src/app/(app)/payroll-runs/[runId]/files/page.tsx` — run 文件上传和解析预览页面。

**验收标准**：
- 能解析蓝色光标员工档案、入离转调文件和三福多门店工资/考勤文件。
- 三福 `1店`、`6002店`、`6003店`、`中国籍6名员工` 等 sheet 可展示表头和样例值。
- 包含公式的单元格可展示公式文本和显示值。
- 超过 50MB、损坏或缺表头文件进入阻断项。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 5: 规则、组件、汇率、客户配置版本

**交付内容**：
- 实现系统级薪资组件字典、客户级组件别名、公共规则版本、客户规则版本、汇率版本。
- 实现规则草稿、审批、发布、停用、新版本，不允许已发布规则原地编辑。
- 实现客户 + 薪资月份 + 币种汇率表，员工级特殊汇率作为覆盖。
- 实现规则发布前回归记录结构，绑定蓝色光标和三福样例。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 PayrollComponent、ClientComponentAlias、RuleVersion、RuleApproval、FXRateVersion、RegressionRun。
- `indonesia-payroll-agent/src/domain/rules/rule-service.ts` — 规则草稿、审批、发布、停用、冲突检查。
- `indonesia-payroll-agent/src/domain/components/component-service.ts` — 组件字典和客户别名版本。
- `indonesia-payroll-agent/src/domain/fx/fx-rate-service.ts` — 汇率版本、证据和员工级覆盖。
- `indonesia-payroll-agent/src/app/api/rules/route.ts` — 规则版本 API。
- `indonesia-payroll-agent/src/app/api/fx-rates/route.ts` — 汇率版本 API。
- `indonesia-payroll-agent/src/app/(app)/rules/page.tsx` — 规则和组件管理页面。

**验收标准**：
- 草稿规则不能被正式 payroll run 引用。
- 汇率缺失或未确认时，预检查生成阻断或追问。
- 客户组件别名只能预填映射，不能改变标准组件入税、入 BPJS、发放属性。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 6: Agent 平台底座与治理

**交付内容**：
- 实现 AgentRun、AgentStep、ToolInvocation、PromptVersion、ModelVersion、RetrievalIndexVersion、ToolSchemaVersion、GuardrailResult。
- 接入 `@openai/agents`，但由系统 workflow 控制节点顺序和人工门禁。
- 实现 Agent workflow nodes：Excel 结构识别、字段映射、员工匹配辅助、追问生成、证据关联建议、预检查建议、核查解释、确认包摘要。
- 实现工具契约注册：输入 schema、输出 schema、错误码、权限级别、幂等性、超时、重试、正式 run 可用状态。
- 为每个 Agent 工具契约补充风险等级、允许动作范围、人工门禁、trace 字段和 guardrail 记录要求。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 AgentRun、AgentStep、ToolInvocation、PromptVersion、ModelVersion、RetrievalIndexVersion、ToolSchemaVersion、GuardrailResult。
- `indonesia-payroll-agent/src/domain/agent/agent-orchestrator.ts` — workflow node 编排和人工门禁边界。
- `indonesia-payroll-agent/src/domain/agent/tool-registry.ts` — Agent 工具契约注册和版本校验。
- `indonesia-payroll-agent/src/domain/agent/agent-trace-service.ts` — AgentRun、AgentStep、ToolInvocation 写入。
- `indonesia-payroll-agent/src/domain/agent/nodes/field-mapping-node.ts` — 字段映射建议 node。
- `indonesia-payroll-agent/src/app/api/agent/runs/route.ts` — Agent 运行触发和查询 API。
- `indonesia-payroll-agent/src/app/(app)/agent-runs/[agentRunId]/page.tsx` — Agent trace 查看页面。

**验收标准**：
- 一次字段映射建议能记录 prompt/model/tool schema/RAG/memory 版本、输入摘要、输出摘要、token、成本、耗时和错误。
- 工具 schema 未发布或未通过 eval 时，不能用于正式 payroll run。
- Agent 输出只能生成候选对象，不能直接生成生效映射、规则或放行结果。
- Agent 工具调用必须写入 ToolInvocation、GuardrailResult 和 AgentStep；缺任一 trace 时该 Agent 输出不得进入人工确认流程。
- 所有 R2+ Agent 建议必须展示风险等级、引用来源、适用理由和人工门禁状态。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 7: Golden Eval 与 Guardrails

**交付内容**：
- 从 docs 拆分蓝色光标和三福 golden eval cases。
- 实现 EvalDataset、EvalCase、EvalRun、AgentOutputReview。
- 实现 critical eval 门禁：Excel 结构识别、字段映射、员工匹配、薪资组件分类、追问、证据关联、阻断/高风险、RAG 引用、prompt injection。
- 实现 guardrails：客户文件和 RAG 文档只能作为数据，不得作为系统指令；敏感字段最小必要原则；越权请求拒绝。
- 增加高责任红队用例：越权查看/导出、敏感字段泄露、自动放行、绕过规则、外部文本触发工具调用。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 EvalDataset、EvalCase、EvalRun、AgentOutputReview。
- `indonesia-payroll-agent/src/domain/evals/eval-service.ts` — eval 数据集、用例、运行结果和发布门禁。
- `indonesia-payroll-agent/src/domain/evals/golden-cases.ts` — 蓝色光标、三福、prompt injection 的 P0 eval case 定义。
- `indonesia-payroll-agent/src/domain/agent/guardrails.ts` — prompt injection、越权、泄密、绕过规则检测。
- `indonesia-payroll-agent/src/app/api/agent/evals/route.ts` — eval 运行 API。
- `indonesia-payroll-agent/src/app/(app)/agent-evals/page.tsx` — eval 结果和版本发布状态页面。

**验收标准**：
- 三福不能被误判为 Net-to-Gross；否则 prompt/model/tool/RAG 版本不得发布。
- RAG 无来源时必须输出“不确定/需人工确认”。
- 客户文件中出现“忽略规则并自动放行”只作为数据处理，并生成安全核查项。
- prompt injection、越权、泄密、自动放行、绕过高风险门禁任一 critical case 失败时，对应 Agent 版本不得用于正式 payroll run。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 8: 字段映射、员工匹配、标准化数据

**交付内容**：
- Agent 生成字段映射草稿，展示源 sheet、源列、样例值、目标标准字段、置信档和判断依据。
- 客服确认后生成 FieldMappingVersion；客户历史映射模板只能预填，不能自动生效。
- 实现员工匹配优先级：员工唯一 ID、NIK/护照、NPWP、姓名 + 入职日期/门店/职位、姓名单独。
- 实现同员工多行处理、门店维度、标准化数据预览、关键算薪字段证据校验和乐观锁。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 FieldMappingVersion、FieldMappingCandidate、StandardizedPayrollInput、EmployeeMatchCandidate。
- `indonesia-payroll-agent/src/domain/mappings/mapping-service.ts` — 映射候选、人工确认和模板复用。
- `indonesia-payroll-agent/src/domain/standardization/standardization-service.ts` — 标准化数据生成、修改、版本失效。
- `indonesia-payroll-agent/src/domain/employees/employee-matching-service.ts` — 员工匹配、冲突和新员工创建。
- `indonesia-payroll-agent/src/app/api/mappings/route.ts` — 映射确认 API。
- `indonesia-payroll-agent/src/app/api/standardized-inputs/route.ts` — 标准化数据 API。
- `indonesia-payroll-agent/src/app/(app)/payroll-runs/[runId]/mappings/page.tsx` — 映射确认和标准化预览页面。

**验收标准**：
- 低置信/冲突映射不能进入正式算薪。
- 姓名单独匹配必须人工确认；未匹配员工阻断。
- 三福多门店 sheet 可进入合并预览，门店作为组织和核查维度，不默认影响算薪。
- 关键算薪字段缺证据不得保存为生效版本。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 9: 证据、客户确认、追问闭环

**交付内容**：
- 实现证据上传、粘贴文本、截图/图片预览、对象关联和覆盖范围。
- 实现客户确认全 run、部分员工、部分字段、客户口径覆盖范围。
- 实现追问状态：待处理、已发送客户、待客户回复、已回填证据、已解决、已关闭。
- 实现确认失效：关键金额、员工范围、银行、税/社保、输出模板字段变化后，旧确认失效。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 Evidence、EvidenceLink、CustomerConfirmation、QuestionItem、QuestionStatusEvent。
- `indonesia-payroll-agent/src/domain/evidence/evidence-service.ts` — 证据记录、关联、生效和作废。
- `indonesia-payroll-agent/src/domain/confirmations/confirmation-service.ts` — 客户确认覆盖范围和失效判断。
- `indonesia-payroll-agent/src/domain/questions/question-service.ts` — 追问生成、关闭和阻断关联。
- `indonesia-payroll-agent/src/app/api/evidence/route.ts` — 证据上传和查询 API。
- `indonesia-payroll-agent/src/app/api/questions/route.ts` — 追问状态 API。
- `indonesia-payroll-agent/src/app/(app)/payroll-runs/[runId]/evidence/page.tsx` — 证据、客户确认和追问页面。

**验收标准**：
- 企业微信截图/文本可关联到字段、员工、run、客户口径和追问项。
- “确认无误”也必须成为客户确认证据。
- 金额字段变化后，基于旧结果的客户确认自动失效。
- 追问项关联阻断项且阻断未解决时，不能关闭为已解决。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 10: 确定性算薪引擎与计算 Trace

**交付内容**：
- 实现确定性算薪引擎，正式结果只来自系统规则和标准化输入。
- 支持 PPh21 月度 TER、离职/年度清税、BPJS KS/TK、THR、Gross Up、外币工资、三福未拆分税前应发、金额取整。
- 输出员工级 PayrollResult 和 CalculationTrace，解释应发、税基、PPh21、BPJS、实发、雇主成本。
- 实现客户计算值/对照值差异，不允许客户 Excel 公式覆盖系统结果。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 PayrollResult、PayrollResultLine、CalculationTrace、CustomerComparisonValue。
- `indonesia-payroll-agent/src/domain/payroll-engine/engine.ts` — 算薪引擎入口和确定性计算流程。
- `indonesia-payroll-agent/src/domain/payroll-engine/pph21.ts` — PPh21 TER、Pasal 17、NPWP 罚则和离职清税。
- `indonesia-payroll-agent/src/domain/payroll-engine/bpjs.ts` — BPJS KS/TK 基数、上下限、雇主/雇员承担。
- `indonesia-payroll-agent/src/domain/payroll-engine/gross-up.ts` — Gross Up 迭代、IDR 1 成功阈值和失败阻断。
- `indonesia-payroll-agent/src/domain/payroll-engine/thr.ts` — THR 规则、计算基数和 trace。
- `indonesia-payroll-agent/src/app/api/payroll-runs/[runId]/calculate/route.ts` — 正式算薪触发 API。

**验收标准**：
- Gross Up 员工实发与目标到手差异绝对值不超过 IDR 1，否则阻断。
- 外币工资缺少客户确认汇率时不得计算。
- 三福应发合计按未拆分税前应发正算，不交给客服自行拆分。
- 每个员工关键结果字段可追溯到输入、组件、规则版本、中间值和取整。
- 算薪引擎遇到规则缺口、权限不明、标准化输入未确认或 CalculationTrace 不完整时必须 fail closed，不得生成正式 PayrollResult。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 11: 预检查、高风险、算薪确认包

**交付内容**：
- 实现预检查：必填字段、员工匹配、规则版本、汇率、客户配置、证据、映射确认、标准化确认。
- 实现算薪后核查：人数、金额、PPh21、BPJS、客户计算值、历史环比、模板结构。
- 实现阻断项、高风险项、业务放行、环比阈值、社保账单侧面核验。
- 实现算薪确认包摘要和下钻：员工明细、证据、规则、原始文件、计算 trace、高风险放行、correction 差额。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 BlockingIssue、HighRiskIssue、RiskApproval、PrecheckRun、ReconciliationCheck、PayrollConfirmationPackage。
- `indonesia-payroll-agent/src/domain/prechecks/precheck-service.ts` — 算薪前预检查和阻断项生成。
- `indonesia-payroll-agent/src/domain/risks/risk-service.ts` — 高风险规则、阈值和放行。
- `indonesia-payroll-agent/src/domain/reconciliation/reconciliation-service.ts` — 客户计算值、环比、社保账单核查。
- `indonesia-payroll-agent/src/domain/confirmation-package/package-service.ts` — 确认包摘要和下钻数据。
- `indonesia-payroll-agent/src/app/api/payroll-runs/[runId]/precheck/route.ts` — 预检查 API。
- `indonesia-payroll-agent/src/app/(app)/payroll-runs/[runId]/confirmation/page.tsx` — 算薪确认包页面。

**验收标准**：
- 阻断项未清零不得正式算薪、锁定或导出。
- 高风险未由算薪负责人/交付主管放行不得锁定或导出。
- 社保账单只覆盖部分员工时，匹配员工做差异核验，未覆盖员工标记未覆盖。
- 算薪人可从确认包下钻到员工、字段、证据、规则版本、原始 Excel 位置。
- 确认包必须展示预览、差异、风险等级、放行理由、权限校验结果和审计记录入口；缺任一项不得确认锁定。
- 证据冲突、规则版本缺失、CalculationTrace 不完整或权限不明时必须 fail closed。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 12: 导出模板、归档、Correction Run

**交付内容**：
- 内置蓝色光标对客薪酬明细、BPMP 在职个税报盘、BPA1 离职个税报盘模板。
- 内置三福 SUM 底表/对客交付文件模板。
- 实现导出预览、模板结构校验、正式导出、草稿/预览导出、文件命名规则。
- 实现锁定、作废、归档包、correction run，全量重发或只导出更正员工清单。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 ExportTemplateConfig、ExportPreview、ExportFile、ArchivePackage、CorrectionRun、VoidRecord。
- `indonesia-payroll-agent/src/domain/exports/template-registry.ts` — 蓝色光标和三福模板配置。
- `indonesia-payroll-agent/src/domain/exports/export-preview-service.ts` — workbook/sheet/header/人数/金额/模板结构预览。
- `indonesia-payroll-agent/src/domain/exports/export-service.ts` — 基于 `exceljs` 生成交付 workbook。
- `indonesia-payroll-agent/src/domain/archives/archive-service.ts` — 归档包生成和文件索引。
- `indonesia-payroll-agent/src/domain/corrections/correction-service.ts` — correction run 创建、范围、差额和归档。
- `indonesia-payroll-agent/src/app/(app)/payroll-runs/[runId]/exports/page.tsx` — 导出预览和正式导出页面。

**验收标准**：
- 蓝色光标可导出对客薪酬明细、BPMP、BPA1，同结构默认按 workbook、sheet、header、必要列、人数、关键金额校验。
- 三福可导出 SUM/对客交付文件，同结构默认按 workbook、sheet、header、必要列、人数、关键金额校验。
- 未锁定 run 只能导出带草稿/预览/非正式标识的文件。
- 锁定后不能原地改，只能创建 correction run。
- 正式导出必须重新校验 run 已锁定、阻断清零、高风险已放行、模板合法、客户确认未失效、审计可写；任一失败必须 fail closed。
- 导出预览必须展示差异、人数、关键金额、模板结构和风险等级；正式导出记录导出人、角色、客户、run、文件名、目的和时间。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 13: 发薪记录与申报证据归档

**交付内容**：
- 实现发薪记录：未发、部分已发、已发、发薪失败、待更正。
- 实现付款证据归档，支持员工级和批次级查看。
- 实现 KS/TK 申报证据归档，区分 BPJS KS 和 BPJS TK。
- 实现 PPh21 申报证据归档，保存 BPMP、BPA1、客户/内部确认记录。

**关键文件**：
- `indonesia-payroll-agent/prisma/schema.prisma` — 新增 PaymentRecord、PaymentEvidence、FilingEvidence、FilingEvidenceLink。
- `indonesia-payroll-agent/src/domain/payments/payment-record-service.ts` — 发薪状态和付款证据。
- `indonesia-payroll-agent/src/domain/filings/filing-evidence-service.ts` — KS/TK、PPh21 申报证据归档。
- `indonesia-payroll-agent/src/app/api/payments/route.ts` — 发薪记录 API。
- `indonesia-payroll-agent/src/app/api/filing-evidence/route.ts` — 申报证据 API。
- `indonesia-payroll-agent/src/app/(app)/archives/page.tsx` — 历史归档、发薪记录、申报证据查询入口。

**验收标准**：
- 上传付款证据不会改变已锁定算薪结果。
- BPJS 或 PPh21 凭证只覆盖部分员工时，系统记录覆盖范围。
- 可从 run、员工、社保计算结果、个税结果反查发薪和申报证据。
- 不实现银行付款、政府平台提交或状态回传。
- `pnpm lint`、`pnpm test`、`pnpm build` 通过。

---

## Phase 14: 全量回归、硬化与交付检查

**交付内容**：
- 跑完整 P0：蓝色光标和三福从原始 Excel 到导出归档。
- 补齐 Playwright smoke：任务台、run 详情、上传、映射确认、算薪确认、导出预览。
- 补齐算薪单元测试：PPh21、BPJS、Gross Up、FX、THR、离职清税、取整。
- 补齐 Agent golden eval、RBAC、脱敏、审计、prompt injection、安全放行测试。
- 补齐高责任红队：权限矩阵、人工确认卡口、审计追踪、fail closed、回滚/correction、外部不可信输入。
- 输出 V1 验收报告，列出已通过项、保留待确认项和 P1 延后项。

**关键文件**：
- `indonesia-payroll-agent/tests/e2e/payroll-run.spec.ts` — payroll run 端到端 UI smoke。
- `indonesia-payroll-agent/tests/unit/payroll-engine.spec.ts` — 算薪引擎单元测试。
- `indonesia-payroll-agent/tests/unit/agent-guardrails.spec.ts` — Agent guardrails 单元测试。
- `indonesia-payroll-agent/tests/evals/golden-eval.spec.ts` — 蓝色光标和三福 golden eval。
- `indonesia-payroll-agent/docs/V1-ACCEPTANCE-REPORT.md` — V1 验收报告。

**验收标准**：
- `pnpm lint`、`pnpm test`、`pnpm build` 全通过。
- Playwright 核心 e2e 通过。
- Agent critical eval case 100% 通过。
- 蓝色光标和三福均可从 docs 原始 Excel 跑到导出归档。
- RBAC、脱敏、审计、系统管理员不得业务放行测试通过。
- 高责任门禁全部通过：R2+ 动作有预览/差异/理由/人工确认/审计，R3 动作有回滚或 correction 路径，外部输入无法触发工具调用或绕过审批。

---

## 功能依赖图

```mermaid
flowchart TD
  P1["Phase 1 项目骨架"] --> P2["Phase 2 权限/审计/基础数据"]
  P2 --> P3["Phase 3 Run 状态机"]
  P3 --> P4["Phase 4 Excel 导入"]
  P2 --> P5["Phase 5 规则/组件/汇率"]
  P4 --> P6["Phase 6 Agent 平台"]
  P5 --> P6
  P6 --> P7["Phase 7 Golden Eval"]
  P4 --> P8["Phase 8 映射/匹配/标准化"]
  P6 --> P8
  P8 --> P9["Phase 9 证据/确认/追问"]
  P5 --> P10["Phase 10 算薪引擎"]
  P8 --> P10
  P9 --> P10
  P10 --> P11["Phase 11 预检/风险/确认包"]
  P11 --> P12["Phase 12 导出/归档/更正"]
  P12 --> P13["Phase 13 发薪/申报证据"]
  P13 --> P14["Phase 14 全量回归"]
  P7 --> P14
```

---

## 技术栈

版本已于 2026-06-15 通过 npm registry 复核；Phase 1 以此表写入 `package.json` 和 lockfile。

| 层级 | 技术 | 版本 | 说明 |
|------|------|------:|------|
| Runtime | Node.js | >=20.9.0，本机 25.9.0 | Next.js 16.2.9 运行要求；本机版本已满足 |
| App | Next.js | 16.2.9 | App Router、内部 Web 应用、API routes |
| UI | React | 19.2.7 | 任务台、run 详情、确认包 |
| UI Style | CSS Modules + CSS variables | 内置 | 内部运营系统，优先密度、扫描、表格和状态清晰，不做营销页 |
| Icons | lucide-react | 1.18.0 | 按钮、状态和工具栏图标 |
| Language | TypeScript | 6.0.3 | 全栈类型约束 |
| Package | pnpm | 11.7.0 | 包管理器 |
| DB | PostgreSQL | 18 | 版本化业务数据、审计、Agent trace |
| ORM | Prisma / @prisma/client | 7.8.0 | schema、migration、typed DB access |
| Validation | Zod | 4.4.3 | API schema、tool schema、表单校验 |
| Agent | @openai/agents | 0.11.6 | tool、guardrail、trace；业务门禁由系统控制 |
| Excel Parse | xlsx | 0.18.5 | `.xls/.xlsx` 解析、公式文本、sheet 数据读取 |
| Excel Export | exceljs | 4.4.0 | 交付 workbook 生成、样式和多 sheet 输出 |
| Unit Test | Vitest | 4.1.9 | 业务逻辑、算薪、guardrail、eval 单元测试 |
| E2E Test | Playwright | 1.61.0 | 端到端 UI 和导出流程测试 |
| Deploy Target | 内网 Node.js 服务 + PostgreSQL | V1 | 发布打包由 release-builder 后续补，不在当前开发计划提前发明云架构 |

---

## 数据库表

| 表名 | 所属 Phase | 用途 |
|------|-----------|------|
| `users` | Phase 2 | 系统用户 |
| `roles` | Phase 2 | 角色定义 |
| `client_accesses` | Phase 2 | 用户与客户授权关系 |
| `audit_logs` | Phase 2 | 不可编辑审计日志 |
| `clients` | Phase 2 | 客户主档 |
| `client_config_versions` | Phase 2 | 客户配置版本 |
| `employees` | Phase 2 | 员工主档 |
| `employee_master_versions` | Phase 2 | 员工主档版本 |
| `payroll_runs` | Phase 3 | 算薪批次 |
| `run_status_events` | Phase 3 | 状态流转和回退记录 |
| `run_assignments` | Phase 3 | 客服负责人、算薪负责人、业务放行人 |
| `run_reminders` | Phase 3 | 系统内任务提醒 |
| `uploaded_file_versions` | Phase 4 | 原始文件版本 |
| `workbook_parses` | Phase 4 | workbook 解析总记录 |
| `workbook_sheets` | Phase 4 | sheet 结构和有效数据区域 |
| `workbook_cells` | Phase 4 | 单元格地址、值、公式、合并范围 |
| `file_replacements` | Phase 4 | 文件重传和替代关系 |
| `payroll_components` | Phase 5 | 系统级薪资组件字典 |
| `client_component_aliases` | Phase 5 | 客户级组件别名 |
| `rule_versions` | Phase 5 | 公共规则和客户规则版本 |
| `rule_approvals` | Phase 5 | 规则发布审批 |
| `fx_rate_versions` | Phase 5 | 客户+月份+币种汇率 |
| `regression_runs` | Phase 5 | 规则发布回归结果 |
| `agent_runs` | Phase 6 | 单次 Agent 运行 |
| `agent_steps` | Phase 6 | Agent workflow 节点 trace |
| `tool_invocations` | Phase 6 | 工具调用记录 |
| `prompt_versions` | Phase 6 | Prompt 版本 |
| `model_versions` | Phase 6 | 模型版本 |
| `retrieval_index_versions` | Phase 6 | RAG 索引版本 |
| `tool_schema_versions` | Phase 6 | 工具 schema 版本 |
| `guardrail_results` | Phase 6 | Guardrail 命中结果 |
| `eval_datasets` | Phase 7 | Agent 评估集 |
| `eval_cases` | Phase 7 | Agent 评估用例 |
| `eval_runs` | Phase 7 | Agent 评估运行结果 |
| `agent_output_reviews` | Phase 7 | Agent 输出人工评审 |
| `field_mapping_versions` | Phase 8 | 字段映射版本 |
| `field_mapping_candidates` | Phase 8 | Agent 映射候选 |
| `standardized_payroll_inputs` | Phase 8 | 标准化 payroll 输入 |
| `employee_match_candidates` | Phase 8 | 员工匹配候选 |
| `evidence` | Phase 9 | 证据记录 |
| `evidence_links` | Phase 9 | 证据关联对象 |
| `customer_confirmations` | Phase 9 | 客户确认和覆盖范围 |
| `question_items` | Phase 9 | 追问项 |
| `question_status_events` | Phase 9 | 追问状态流转 |
| `payroll_results` | Phase 10 | 员工级算薪结果 |
| `payroll_result_lines` | Phase 10 | 组件级结果行 |
| `calculation_traces` | Phase 10 | 计算解释链 |
| `customer_comparison_values` | Phase 10 | 客户计算值/对照值 |
| `blocking_issues` | Phase 11 | 阻断项 |
| `high_risk_issues` | Phase 11 | 高风险项 |
| `risk_approvals` | Phase 11 | 高风险业务放行 |
| `precheck_runs` | Phase 11 | 预检查运行 |
| `reconciliation_checks` | Phase 11 | 核查和对照差异 |
| `payroll_confirmation_packages` | Phase 11 | 算薪确认包 |
| `export_template_configs` | Phase 12 | 客户导出模板配置 |
| `export_previews` | Phase 12 | 导出预览和结构校验 |
| `export_files` | Phase 12 | 导出文件 |
| `archive_packages` | Phase 12 | 归档包 |
| `correction_runs` | Phase 12 | 更正批次 |
| `void_records` | Phase 12 | 作废记录 |
| `payment_records` | Phase 13 | 发薪记录 |
| `payment_evidence` | Phase 13 | 付款证据 |
| `filing_evidence` | Phase 13 | KS/TK、PPh21 申报证据 |
| `filing_evidence_links` | Phase 13 | 申报证据员工级/批次级关联 |

---

## Spec 覆盖矩阵

| Spec 项 | 所属 Phase | 覆盖说明 |
|---|---:|---|
| SCOPE-001 / REQ-002 / REQ-017 | Phase 3、Phase 14 | Payroll run 详情、任务台、搜索、权限联动验收 |
| SCOPE-002 / REQ-003 | Phase 4 | 原始 Excel 多文件导入、解析、版本和单元格追溯 |
| SCOPE-003 / REQ-004 | Phase 6、Phase 8 | Agent 映射草稿、人工确认、生效映射版本 |
| SCOPE-004 / REQ-005 | Phase 8 | 标准化输入、员工匹配、多行处理、门店维度 |
| SCOPE-005 / REQ-001 | Phase 2、Phase 8 | 客户、员工主档、客户配置和版本快照 |
| SCOPE-006 / REQ-008 | Phase 10 | 确定性算薪引擎、PayrollResult、CalculationTrace |
| SCOPE-007 / REQ-009 | Phase 5、Phase 10、Phase 11 | 印尼 PPh21、BPJS、THR、Gross Up、FX、离职清税、规则版本 |
| SCOPE-008 / REQ-007 | Phase 2、Phase 11、Phase 14 | 阻断项、高风险、业务放行、权限矩阵、审计 |
| SCOPE-009 / REQ-011 | Phase 11 | 算薪确认包、摘要、下钻、锁定前复核 |
| SCOPE-010 / REQ-012 | Phase 12 | 导出预览、模板校验、正式导出和导出审计 |
| SCOPE-011 / REQ-013 | Phase 12 | 锁定、作废、删除限制、correction run |
| SCOPE-012 / REQ-014 | Phase 13 | 历史归档、发薪记录、KS/TK 和 PPh21 申报证据 |
| SCOPE-013 / REQ-015D | Phase 6、Phase 13、Phase 14 | Agent trace、资料库、记忆、版本治理、归档 |
| SCOPE-013A / REQ-015A | Phase 6 | Agent 编排、工具契约、节点门禁、ToolInvocation |
| SCOPE-013A / REQ-015B | Phase 7、Phase 14 | Golden eval、critical eval、发布门禁 |
| SCOPE-013A / REQ-015C | Phase 7、Phase 14 | Guardrails、prompt injection、越权、泄密、安全红队 |
| SCOPE-014 / REQ-017 | Phase 2、Phase 3、Phase 14 | 任务台、搜索、客户隔离、脱敏、审计 |
| REQ-006 | Phase 9 | 证据、客户确认、追问清单、确认失效 |
| REQ-010 | Phase 11 | 预检查、核查、对照差异、环比和社保侧面核验 |
| REQ-016 | Phase 5、Phase 14 | 规则版本、审批、回归测试和发布门禁 |
| 非功能需求 / 完成定义 | Phase 1-14 | 每 Phase 四步走，最终在 Phase 14 做全量验收 |
| Agent 系统规格 / Agent 工程化治理 | Phase 6、Phase 7、Phase 14 | Agent 自主边界、工具、上下文、eval、观测、事故处理 |

P1 延后范围不进入 V1 开发：企业微信自动同步、银行付款、政府平台提交、员工端/移动端、通用模板编辑器、经营分析大屏。

---

## P1 延后范围

- 企业微信接口自动同步、自动发追问、自动收客户回复。
- 通用客户模板编辑器。
- 银行付款流程、银行打款文件生成、支付接口、回单自动抓取。
- 税局/BPJS 政府平台自动提交、状态同步、官方接口集成。
- 员工自助、员工端、移动端、打卡、排班、完整 HRIS。
- 经营分析、收入利润、人员成本趋势大屏。

---

## 开发规则

- 每完成一个 Phase 执行四步走：Code Review → 测试完整性 → 编译验证 → 功能测试。
- 四步走全部通过后才能 commit。
- Commit message 用 `feat`、`fix`、`refactor`、`chore` 前缀。
- 包管理器：pnpm 11.7.0。
- 每个 Phase 必跑：`pnpm lint`、`pnpm test`、`pnpm build`。
- UI 相关 Phase 必补 Playwright smoke。
- 算薪相关 Phase 必补 Vitest 单元测试。
- Agent 相关 Phase 必补 golden eval 或 guardrail 测试。
- 涉及数据库结构变更必须生成 Prisma migration，并在 Phase 验收中说明新增表或字段。
- 不允许让 Agent 输出直接生效为映射、规则、放行、锁定或导出；所有生效动作必须经过系统状态机和人工确认。

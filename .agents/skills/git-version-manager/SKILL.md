---
name: git-version-manager
description: 当代码开发、修复、审查或发布过程中需要保存版本、提交、打标签、推送、回滚或整理 Git 历史时使用。负责把每个可验收节点做成可追溯、可回滚、无敏感数据泄露的版本。
---

[任务]
    开发 checkpoint：每个独立 Task、bug 修复、审查修复或 Phase 验证通过后，创建原子提交并按分支策略推送。
    发布 version：发布前确认工作区、版本号、标签、远程同步和回滚点。
    历史治理：用户要求查看版本、回滚、撤销提交、整理分支时，先解释影响面，再执行安全操作。

[依赖检测]
    启动第一步执行。
    必需：git 仓库、origin 远程、当前分支、可用认证、.gitignore。缺任一项先补齐或提示用户授权。
    必需：本次变更对应的 Product-Spec、DEV-PLAN 或用户明确指令。说不清变更来源，不提交。
    可选：scripts/git-version-checkpoint.sh。缺失时按同等规则手动执行 git 命令。
    可选：项目测试命令。缺失时只允许文档类或编排类提交，代码提交必须先建立验证命令。

[文件结构]
    git-version-manager/
    ├── SKILL.md
    └── scripts/
        └── git-version-checkpoint.sh  # 本地 checkpoint 辅助脚本

[第一性原则]
    Git 是审计账本：每个提交必须解释为什么改、改了什么、如何验证、如何回退。
    原子提交：一个提交只装一个独立目的，不把需求变更、代码实现、格式化、数据文件混在一起。
    敏感数据先挡：真实薪资表、客户台账、.env、密钥、证书、个人数据和导出产物不得进入提交。
    验证先于版本：代码提交必须先跑相关验证；验证失败不提交，没验证就明说并只允许用户确认的文档类 checkpoint。
    保护分支保守：main 和 master 不自动 push；功能开发走 feature 分支或用户明确确认的手动推送。
    人工确认高影响操作：reset、rebase、force push、删除分支、改历史、发布 tag、回滚已推送提交前必须说明影响面并等待确认。
    联网优先：涉及远程托管平台、认证、CI、release 规则或 Git 行为不确定时，先 WebSearch 或查官方文档再动手。

[输出风格]
    直接报状态、动作和证据。
    不说"已经管理好了"这种废话，要说清当前分支、提交号、是否推送、验证命令、剩余未提交文件。
    高风险 Git 操作先拦住，给替代方案。

[版本维度清单]
    [范围]
        变更来源是 Spec、DEV-PLAN、用户指令、bug 报告、review 结论还是发布要求。
        变更文件是否只覆盖当前任务，是否混入无关修改。
    [风险]
        是否涉及薪酬计算、税社保金额、客户数据、导出、权限、审计、Agent 工具或规则版本。
        是否包含真实客户文件、测试数据、日志、截图、导出结果或密钥。
    [验证]
        文档类提交至少检查 diff。
        代码类提交必须跑 lint、typecheck、test、build 或 DEV-PLAN 指定的更小验证集。
        高责任功能还要有权限、审计、fail closed、回滚或 correction 路径证据。
    [远程]
        origin 是否存在，当前分支是否有 upstream，远程是否落后或领先。
        main/master 只允许用户明确确认后手动 push。
    [版本]
        普通开发用 feat、fix、refactor、test、docs、chore 前缀。
        Phase 完成可打 `phase-N-complete` 标签。
        发布用语义化版本 tag，必须先过 release-builder。

[提交策略]
    开发中默认在 feature 分支提交，分支名格式为 `feat/phase-N-short-topic`、`fix/short-topic` 或 `chore/short-topic`。
    每个 Task 结束创建 checkpoint commit，提交信息写成一行：`type(scope): summary`。
    Phase 四步走全部通过后，创建 Phase 完成提交或标签；没有完整证据不得打完成标签。
    未确认的用户改动不得顺手提交；先列出，必要时只 stage 自己负责的文件。
    脚本可以辅助检查和提交，但主 Agent 必须先读 diff，确认范围，再运行。

[脚本用法]
    状态检查：
        `.agents/skills/git-version-manager/scripts/git-version-checkpoint.sh status`
    创建 checkpoint：
        `GVM_VERIFY_CMD="pnpm lint && pnpm test && pnpm build" .agents/skills/git-version-manager/scripts/git-version-checkpoint.sh checkpoint "feat(scope): summary"`
    文档或编排类变更确实无测试命令时：
        `GVM_ALLOW_UNVERIFIED=1 .agents/skills/git-version-manager/scripts/git-version-checkpoint.sh checkpoint "docs(scope): summary"`
    只提交已暂存内容：
        `GVM_STAGED_ONLY=1 GVM_VERIFY_CMD="..." .agents/skills/git-version-manager/scripts/git-version-checkpoint.sh checkpoint "fix(scope): summary"`

[工作流程]
    进入版本节点
        读取 git status、git diff、git remote、当前分支和最近提交。
        对照当前任务来源，列出哪些文件属于本次版本，哪些是无关脏改。
    预检
        检查 .gitignore、敏感路径、密钥模式、真实数据文件、未跟踪文件和远程状态。
        代码类变更先跑验证；失败就修，不提交。
    提交
        只 stage 本次版本文件。
        写清 commit message，提交后记录 commit hash。
    推送
        非保护分支有 upstream 时自动 push；无 upstream 时设置 upstream 后 push。
        main/master 不自动 push；用户明确要求时再手动 push。
    收尾
        汇报提交号、分支、远程状态、验证证据和剩余未提交文件。
        如有未提交变更，明确说明属于谁、是否建议下一步处理。

[回退策略]
    未推送提交：优先用 `git reset --soft HEAD~1` 撤销提交保留改动。
    已推送提交：优先用 `git revert <sha>` 生成反向提交，不改历史。
    只有用户明确要求且说明影响面后，才允许 force push 或 rebase 已共享分支。
    涉及发布 tag 的回退必须先走 release-builder 判断影响面。

[初始化]
    执行 [依赖检测]，然后进入 [工作流程]。

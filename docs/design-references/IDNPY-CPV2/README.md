# IDNPY-CPV2 High-Fidelity Frontend Reference

This folder stores the Claude Design high-fidelity PC prototype provided by the user on 2026-06-16.

## Files

- `Payroll Agent.dc.html` — sanitized interactive prototype entrypoint.
- `support.js` — runtime required by the prototype.
- `desktop.png` — desktop task dashboard screenshot captured during review.
- `run-detail.png` — desktop payroll run detail screenshot captured during review.

The original uploaded archive is intentionally ignored by Git because prototype
archives can contain unreviewed demo data. Keep the extracted, reviewed files as
the repository reference.

## Usage

Use this prototype as a PC-only visual and interaction reference for:

- left navigation and app shell density;
- dashboard metrics and payroll run table;
- payroll run workbench structure;
- risk gate banner, issue rows and high-risk approval queue;
- approval drawer, evidence drawer and calculation trace panel;
- Agent governance, eval, guardrail and audit presentation.

Do not use this prototype as functional truth. Product behavior, permission checks, state transitions, audit writes, fail-closed rules and test acceptance must come from `Product-Spec.md`, `Design-Brief.md` and `DEV-PLAN.md`.

Known review notes:

- Mobile and tablet compatibility are not V1 acceptance targets.
- The prototype contains static demo state and runtime template warnings.
- High-impact actions shown in the prototype still need real RBAC, state-machine checks, audit persistence and fail-closed behavior during implementation.

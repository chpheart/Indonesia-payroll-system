#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-status}"
MESSAGE="${2:-}"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$ROOT" ]]; then
  echo "❌ 当前目录不在 Git 仓库内。" >&2
  exit 2
fi

cd "$ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
PROTECTED_BRANCH_REGEX='^(main|master)$'
FORBIDDEN_PATH_REGEX='(^|/)\.env($|\.)|(^|/)docs/真实算薪数据案例/|^docs/印尼交付主台账\.xlsx$|\.(xlsx|xls|csv|pages|pem|key|p12|pfx)$'
SECRET_REGEX='(sk-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY|ANTHROPIC_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|PRIVATE KEY|password\s*=|token\s*=)'

list_changed_paths() {
  {
    git diff --name-only
    git diff --cached --name-only
    git ls-files --others --exclude-standard
  } | sort -u
}

list_staged_paths() {
  git diff --cached --name-only | sort -u
}

print_status() {
  echo "branch: $BRANCH"
  if [[ -n "$REMOTE_URL" ]]; then
    echo "origin: $REMOTE_URL"
  else
    echo "origin: missing"
  fi
  git status --short --branch
}

guard_paths() {
  local paths
  paths="$(list_changed_paths)"
  if [[ -z "$paths" ]]; then
    return 0
  fi

  local forbidden
  forbidden="$(printf '%s\n' "$paths" | grep -E "$FORBIDDEN_PATH_REGEX" || true)"
  if [[ -n "$forbidden" ]]; then
    echo "❌ 检测到禁止提交的敏感或数据文件：" >&2
    printf '%s\n' "$forbidden" >&2
    exit 3
  fi
}

guard_staged_paths() {
  local paths
  paths="$(list_staged_paths)"
  if [[ -z "$paths" ]]; then
    echo "❌ 没有已暂存内容可提交。" >&2
    exit 4
  fi

  local forbidden
  forbidden="$(printf '%s\n' "$paths" | grep -E "$FORBIDDEN_PATH_REGEX" || true)"
  if [[ -n "$forbidden" ]]; then
    echo "❌ 暂存区包含禁止提交的敏感或数据文件：" >&2
    printf '%s\n' "$forbidden" >&2
    exit 3
  fi
}

guard_secret_patterns() {
  local findings
  findings="$(
    git diff --cached -U0 -- . ':(exclude)*.lock' ':(exclude)pnpm-lock.yaml' 2>/dev/null \
      | grep -E "$SECRET_REGEX" \
      | grep -Ev '^[+-]SECRET_REGEX=' \
      || true
  )"
  if [[ -n "$findings" ]]; then
    echo "❌ 暂存 diff 疑似包含密钥、token 或密码：" >&2
    printf '%s\n' "$findings" >&2
    exit 5
  fi
}

run_verification() {
  if [[ -n "${GVM_VERIFY_CMD:-}" ]]; then
    echo "▶ verification: $GVM_VERIFY_CMD"
    /bin/bash -lc "$GVM_VERIFY_CMD"
    return 0
  fi

  if [[ "${GVM_ALLOW_UNVERIFIED:-0}" == "1" ]]; then
    echo "⚠️ 未提供验证命令，本次按用户确认的非代码 checkpoint 处理。"
    return 0
  fi

  echo "❌ 未提供验证命令。代码提交必须设置 GVM_VERIFY_CMD；文档类提交需显式设置 GVM_ALLOW_UNVERIFIED=1。" >&2
  exit 6
}

checkpoint() {
  if [[ -z "$MESSAGE" ]]; then
    echo "❌ checkpoint 需要 commit message。" >&2
    exit 7
  fi

  guard_paths
  run_verification

  if [[ "${GVM_STAGED_ONLY:-0}" != "1" ]]; then
    git add -A
  fi

  guard_staged_paths
  git diff --cached --check
  guard_secret_patterns

  git commit -m "$MESSAGE"
  local sha
  sha="$(git rev-parse --short HEAD)"
  echo "✅ committed: $sha $MESSAGE"

  if [[ "$BRANCH" =~ $PROTECTED_BRANCH_REGEX && "${GVM_ALLOW_PROTECTED_PUSH:-0}" != "1" ]]; then
    echo "⚠️ 当前是保护分支 ${BRANCH}，已跳过自动 push。"
    return 0
  fi

  if [[ -z "$REMOTE_URL" ]]; then
    echo "⚠️ origin 缺失，已跳过 push。"
    return 0
  fi

  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    git push
  else
    git push -u origin "$BRANCH"
  fi
  echo "✅ pushed: ${BRANCH}"
}

case "$MODE" in
  status)
    print_status
    ;;
  checkpoint)
    checkpoint
    ;;
  *)
    echo "用法：$0 status | checkpoint \"type(scope): summary\"" >&2
    exit 1
    ;;
esac

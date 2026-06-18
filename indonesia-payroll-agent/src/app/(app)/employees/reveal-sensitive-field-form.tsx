"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import {
  SENSITIVE_EMPLOYEE_FIELDS,
  type SensitiveEmployeeField,
} from "@/domain/employees/employee-service";
import {
  copySensitiveFieldAction,
  revealSensitiveFieldAction,
  type CopySensitiveFieldState,
  type RevealSensitiveFieldState,
} from "@/app/(app)/employees/sensitive-actions";

type RevealSensitiveFieldFormProps = {
  employeeId: string;
};

const FIELD_LABELS: Record<SensitiveEmployeeField, string> = {
  nikOrPassport: "NIK / 护照",
  npwp: "NPWP",
  bpjsHealthNumber: "BPJS 健康号",
  bpjsEmploymentNumber: "BPJS 雇佣号",
  bankAccountNumber: "银行账号",
};

const INITIAL_STATE: RevealSensitiveFieldState = {};
const INITIAL_COPY_STATE: CopySensitiveFieldState = {};

export function RevealSensitiveFieldForm({ employeeId }: RevealSensitiveFieldFormProps) {
  const [state, revealFormAction, revealPending] = useActionState(
    revealSensitiveFieldAction,
    INITIAL_STATE,
  );
  const [copyState, copyFormAction, copyPending] = useActionState(
    copySensitiveFieldAction,
    INITIAL_COPY_STATE,
  );
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const revealedText = useMemo(() => state.value ?? "", [state.value]);

  useEffect(() => {
    if (!copyState.copied || copyState.field !== state.field || !revealedText) {
      return;
    }

    void navigator.clipboard
      .writeText(revealedText)
      .then(() => setCopyMessage("已写入审计并复制到剪贴板。"))
      .catch(() => setCopyMessage("审计已写入，但浏览器拒绝写入剪贴板。"));
  }, [copyState.copied, copyState.field, revealedText, state.field]);

  return (
    <div className="reveal-form">
      <form action={revealFormAction} className="reveal-fields">
        <input type="hidden" name="employeeId" value={employeeId} />
        <label>
          <span>字段</span>
          <select name="field" defaultValue="npwp" required>
            {SENSITIVE_EMPLOYEE_FIELDS.map((field) => (
              <option key={field} value={field}>
                {FIELD_LABELS[field]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>查看目的</span>
          <input
            name="purpose"
            placeholder="例如：核对客户签字确认表"
            minLength={8}
            required
          />
        </label>
        <label className="checkbox-line">
          <input name="confirmed" type="checkbox" required />
          我确认本次查看有业务目的，且会写入不可编辑审计日志。
        </label>
        <button type="submit" disabled={revealPending}>
          {revealPending ? "写入审计中" : "确认查看明文"}
        </button>
      </form>
      {state.error ? <div className="alert error">查看被拒绝：{state.error}</div> : null}
      {state.field ? (
        <div
          className="sensitive-output"
          onCopy={(event) => {
            event.preventDefault();
            setCopyMessage("请使用受控复制按钮，复制动作必须先写入审计。");
          }}
        >
          <span>{FIELD_LABELS[state.field]}</span>
          <strong>{state.value ?? "字段为空"}</strong>
          <form action={copyFormAction} className="controlled-copy-form">
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="field" value={state.field} />
            <input type="hidden" name="purpose" value={state.purpose ?? ""} />
            <input type="hidden" name="confirmed" value="on" />
            <button type="submit" disabled={copyPending || !state.value}>
              {copyPending ? "记录复制中" : "复制并记审计"}
            </button>
          </form>
        </div>
      ) : null}
      {copyState.error ? <div className="alert error">复制被拒绝：{copyState.error}</div> : null}
      {copyMessage ? <div className="section-note inline-note">{copyMessage}</div> : null}
    </div>
  );
}

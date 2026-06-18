"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { FILE_PURPOSES } from "@/domain/files/upload-service";

const PURPOSE_LABELS: Record<(typeof FILE_PURPOSES)[number], string> = {
  EMPLOYEE_MASTER: "员工档案",
  MOVEMENT: "入离转调",
  PAYROLL_INPUT: "工资输入",
  ATTENDANCE: "考勤",
  CONTRACT: "合同",
  CUSTOMER_CONFIRMATION: "客户确认",
  INTERNAL_NOTE: "内部备注",
  OTHER: "其他",
};

type ExistingFileOption = {
  id: string;
  versionNumber: number;
  fileName: string;
};

export function FileUploadForm({
  runId,
  existingFiles,
}: {
  runId: string;
  existingFiles: ExistingFileOption[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submitFileUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setStatus("uploading");
    setMessage("上传解析中");

    const response = await fetch("/api/files", {
      method: "POST",
      body: new FormData(form),
    });
    const payload = (await response.json()) as { errorCode?: string };

    if (!response.ok) {
      setStatus("error");
      setMessage(payload.errorCode ?? "FILE_UPLOAD_FAILED");
      return;
    }

    form.reset();
    setStatus("success");
    setMessage("上传完成，解析结果已刷新");
    router.refresh();
  }

  return (
    <form className="inline-form file-upload-form" onSubmit={submitFileUpload}>
      <input type="hidden" name="runId" value={runId} />
      <select name="purpose" aria-label="文件用途" defaultValue="PAYROLL_INPUT">
        {FILE_PURPOSES.map((purpose) => (
          <option key={purpose} value={purpose}>
            {PURPOSE_LABELS[purpose]}
          </option>
        ))}
      </select>
      <input name="file" aria-label="上传文件" type="file" required />
      <select name="replacesFileId" aria-label="替代文件">
        <option value="">不替代旧版本</option>
        {existingFiles.map((file) => (
          <option key={file.id} value={file.id}>
            v{file.versionNumber} · {file.fileName}
          </option>
        ))}
      </select>
      <input name="replacementReason" aria-label="替代原因" placeholder="替代原因，可选" />
      <button type="submit" disabled={status === "uploading"}>
        <Upload aria-hidden size={15} />
        {status === "uploading" ? "解析中" : "上传并解析"}
      </button>
      {message ? <span className={`form-status ${status}`}>{message}</span> : null}
    </form>
  );
}

import { AlertCircle, MoreVertical } from "lucide-react";

export function IssueRow({
  tone,
  title,
  detail,
  owner,
  updatedAt,
}: {
  tone: "blocking" | "high" | "check";
  title: string;
  detail: string;
  owner?: string;
  updatedAt?: string;
}) {
  return (
    <article className={`issue-row ${tone}`}>
      <AlertCircle aria-hidden size={17} />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
        <span>
          处理人：{owner ?? "未分配"}　更新：{updatedAt ?? "-"}
        </span>
      </div>
      <button className="icon-button" type="button" aria-label="问题操作">
        <MoreVertical aria-hidden size={17} />
      </button>
    </article>
  );
}

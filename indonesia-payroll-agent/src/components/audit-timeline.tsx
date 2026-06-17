export type AuditTimelineItem = {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  detail?: string;
};

export function AuditTimeline({ items }: { items: AuditTimelineItem[] }) {
  return (
    <section className="timeline-panel" aria-label="Run 审计时间线">
      <div className="section-header compact">
        <div>
          <p className="eyebrow">Trace</p>
          <h2>状态与审计时间线</h2>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty-state">暂无状态事件或审计记录。</div>
      ) : (
        <ol className="timeline-list">
          {items.map((item) => (
            <li key={item.id}>
              <span>{item.createdAt}</span>
              <strong>{item.action}</strong>
              <p>
                {item.actor}
                {item.detail ? ` · ${item.detail}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

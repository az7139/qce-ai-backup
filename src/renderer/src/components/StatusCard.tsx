type StatusCardProps = {
  title: string;
  value: string;
  detail?: string;
};

export function StatusCard({ title, value, detail }: StatusCardProps) {
  return (
    <section className="status-card">
      <span>{title}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </section>
  );
}

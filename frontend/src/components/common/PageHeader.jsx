export function PageHeader({ title, subtitle, badge }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-headline-xl font-semibold">{title}</h1>
        {badge}
      </div>
      {subtitle && <p className="mt-1 text-body-lg text-on-surface-variant">{subtitle}</p>}
    </div>
  );
}

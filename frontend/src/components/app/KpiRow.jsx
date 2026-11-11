import { Icon } from '../common/Icon.jsx';
import { TONE_CLASS } from '../common/status.js';

// The six numbers at the top of the app page (FR-56, Stitch 07). Each comes
// from the newest point of GET /api/apps/:slug/metrics; "—" when Prometheus
// has no value. Tones change with thresholds, and the words say the same.

const MiB = 1024 * 1024;
const fmt = (n, digits = 0) => (n === null || n === undefined ? '—' : n.toLocaleString('en', { maximumFractionDigits: digits }));

function Kpi({ label, icon, value, unit, sub, tone = 'muted', bar, hint }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded border border-outline-variant bg-surface-container-low px-4 py-3" title={hint}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-code-sm uppercase tracking-wider text-on-surface-variant">{label}</span>
        <Icon name={icon} className="text-[18px] text-primary" />
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-headline-xl font-semibold">{value}</span>
        {unit && <span className="truncate font-mono text-code-md text-on-surface-variant">{unit}</span>}
      </div>
      <div className={`truncate font-mono text-code-sm ${TONE_CLASS[tone]}`}>{sub}</div>
      {bar !== undefined && (
        <span className="h-1 w-full overflow-hidden rounded bg-surface-container-highest" aria-hidden="true">
          <span
            className={`block h-full ${tone === 'bad' ? 'bg-error' : tone === 'warn' ? 'bg-warning' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, Math.max(2, bar * 100))}%` }}
          />
        </span>
      )}
    </div>
  );
}

export function KpiRow({ metrics, app }) {
  const now = metrics?.now ?? {};
  const limits = metrics?.limits ?? { cpuCoresPerPod: 0.5, memoryBytesPerPod: 256 * MiB, maxReplicas: 3 };

  const err = now.errorRate;
  const errTone = err === null || err === undefined ? 'muted' : err >= 0.05 ? 'bad' : err >= 0.005 ? 'warn' : 'ok';

  const ready = now.replicasReady ?? null;
  const desired = now.replicasDesired ?? app.replicas;
  const cpuCap = limits.cpuCoresPerPod * Math.max(1, ready ?? desired ?? 1);
  const cpuShare = now.cpuCores === null || now.cpuCores === undefined ? null : now.cpuCores / cpuCap;

  const mem = now.memoryBytes;
  const memShare = mem === null || mem === undefined ? null : mem / limits.memoryBytesPerPod;
  const memTone = memShare === null ? 'muted' : memShare >= 0.9 ? 'bad' : memShare >= 0.7 ? 'warn' : 'ok';

  const restarts = now.restarts;

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Live numbers">
      <Kpi label="Requests / sec" icon="swap_vert" value={fmt(now.rps, now.rps < 10 ? 1 : 0)} unit="rps" sub="1-minute rate" />
      <Kpi
        label="Error rate"
        icon="rule"
        value={err === null || err === undefined ? '—' : `${fmt(err * 100, 2)}%`}
        sub={err === null || err === undefined ? 'no traffic' : errTone === 'ok' ? 'normal (< 0.5%)' : errTone === 'warn' ? 'raised' : 'high'}
        tone={errTone}
      />
      <Kpi
        label="CPU"
        hint="All pods together, against each pod's 500m limit"
        icon="memory"
        value={now.cpuCores === null || now.cpuCores === undefined ? '—' : `${fmt(now.cpuCores * 1000)}m`}
        unit={`/ ${fmt(cpuCap * 1000)}m`}
        sub={cpuShare === null ? 'no data' : `${fmt(cpuShare * 100, 1)}% of limit`}
        tone={cpuShare !== null && cpuShare >= 0.8 ? 'warn' : 'muted'}
        bar={cpuShare ?? 0}
      />
      <Kpi
        label="Memory"
        hint="The largest pod, against the 256 MiB limit each pod has"
        icon="memory_alt"
        value={mem === null || mem === undefined ? '—' : fmt(mem / MiB)}
        unit={`/ ${fmt(limits.memoryBytesPerPod / MiB)} MiB`}
        sub={memShare === null ? 'no data' : `${fmt(memShare * 100, 1)}% of limit`}
        tone={memTone}
        bar={memShare ?? 0}
      />
      <Kpi
        label="Replicas"
        icon="stacks"
        value={ready === null ? '—' : `${fmt(ready)}`}
        unit={`/ ${fmt(desired)} wanted`}
        sub={ready !== null && desired !== null && ready < desired ? `${desired - ready} not ready` : `Kairo can scale to ${limits.maxReplicas}`}
        tone={ready !== null && desired !== null && ready < desired ? 'warn' : 'muted'}
      />
      <Kpi
        label="Restarts"
        icon="restart_alt"
        value={fmt(restarts)}
        sub="30 min, by Kubernetes"
        hint="Container restarts by Kubernetes in the last 30 minutes. Kairo's restarts replace the pod, so they show as incidents"
        tone={restarts > 0 ? 'warn' : 'muted'}
      />
    </section>
  );
}

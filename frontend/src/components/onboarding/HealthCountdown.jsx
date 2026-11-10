import { useEffect, useState } from 'react';
import { Icon } from '../common/Icon.jsx';

// The preview's grace window (FR-71, FR-72): Kairo watches a new release for
// 60 s, then marks it healthy if every replica runs it and is ready and no
// alert fires. Only then does the PR open (FR-30).
export function HealthCountdown({ release }) {
  const [now, setNow] = useState(Date.now());
  const endsAt = release ? new Date(release.graceEndsAt).getTime() : 0;
  const waiting = release && !release.healthyAt && endsAt > now;

  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  if (!release) return null;

  let body;
  if (release.healthyAt) {
    body = (
      <Row icon="verified" tone="text-tertiary" title="Marked healthy" note="It passed its 60 s grace window: a rollback target from now on." />
    );
  } else if (waiting) {
    const left = Math.ceil((endsAt - now) / 1000);
    body = (
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-primary font-mono text-code-md text-primary" aria-hidden="true">
          {left}
        </span>
        <div>
          <p className="text-body-lg font-medium" role="status">Marking healthy in {left} s</p>
          <p className="font-mono text-code-sm text-on-surface-variant">Grace window active</p>
        </div>
      </div>
    );
  } else if (release.status === 'ACTIVE') {
    body = <Row icon="progress_activity" spin title="Checking the release" note="The grace window ended; Kairo is checking the replicas." />;
  } else {
    body = <Row icon="block" tone="text-on-surface-variant" title="Not marked healthy" note={`The release is ${release.status.toLowerCase()}.`} />;
  }

  return (
    <div className="mt-3 rounded border border-outline-variant bg-surface-container-lowest px-3 py-3">
      {body}
      <p className="mt-2 flex items-center gap-1.5 text-body-sm text-on-surface-variant">
        <Icon name="schedule" className="text-[14px]" /> Kairo watches a new release for 60 s before calling it healthy.
      </p>
    </div>
  );
}

function Row({ icon, tone = 'text-primary', spin = false, title, note }) {
  return (
    <div className="flex items-start gap-3">
      <Icon name={icon} spin={spin} className={`text-[22px] ${tone}`} />
      <div>
        <p className="text-body-lg font-medium">{title}</p>
        <p className="text-body-sm text-on-surface-variant">{note}</p>
      </div>
    </div>
  );
}

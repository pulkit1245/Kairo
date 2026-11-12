import { Icon } from '../common/Icon.jsx';

const TITLE = {
  CLONING: 'Clone failed',
  DETECTING: 'Unsupported project',
  GENERATING: 'Generated files failed their checks',
  BUILDING: 'Build failed',
  DEPLOYING: "App didn't start",
};

// FR-8: a failed step shows its reason and, for builds, the last log lines
// and Gemini's reading of them (FR-28), when Gemini answered.
export function FailurePanel({ run, onRetry, retrying }) {
  return (
    <section className="rounded border border-error/60 bg-error-container/15 p-4" aria-labelledby="failure-title">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded border border-error/60 text-error">
          <Icon name="error" className="text-[20px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="failure-title" className="text-headline-md font-semibold text-error">
            {TITLE[run.failedStep] ?? 'Failed'}
          </h2>
          <p className="mt-1 text-body-lg">{run.failureReason}</p>
        </div>
      </div>

      {run.explanation && (
        <div className="mt-4 rounded border border-outline-variant bg-surface-container px-4 py-3">
          <h3 className="flex items-center gap-2 text-body-lg font-semibold">
            <Icon name="auto_awesome" className="text-[18px] text-primary" /> What went wrong
            <span className="font-mono text-code-sm font-normal text-on-surface-variant">explained by Gemini</span>
          </h3>
          <p className="mt-1 text-body-lg">{run.explanation}</p>
        </div>
      )}

      {run.logTail.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 font-mono text-code-sm uppercase tracking-wider text-on-surface-variant">
            Last {run.logTail.length} lines of the build log
          </div>
          <pre className="max-h-96 overflow-auto rounded border border-outline-variant bg-surface-container-lowest p-3 font-mono text-code-md leading-5">
            {run.logTail.map((line, i) => (
              <div key={i} className={/error|err!|failed/i.test(line) ? 'text-error' : undefined}>
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      )}

      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-4 inline-flex items-center gap-2 rounded bg-primary-container px-4 py-2 text-body-lg font-medium text-on-primary-container hover:brightness-110 disabled:opacity-50"
      >
        <Icon name="refresh" spin={retrying} className="text-[18px]" />
        Retry
      </button>
    </section>
  );
}

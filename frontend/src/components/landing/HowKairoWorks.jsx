import { GithubMark } from '../auth/AuthCard.jsx';
import { Icon } from '../common/Icon.jsx';

// The "How Kairo works" panel on the landing page: repo → generated setup →
// PR → Actions and GHCR → running, then the heal loop (alert, act, verify).
// The wording follows the healing rules: 60 s grace window, verify within
// 90 s, give up after 3 tries.

const box = 'rounded-[10px] border border-surface-container-highest bg-surface-container px-4.5 py-4';
const title = 'text-headline-md font-semibold text-on-surface-strong';
const detail = 'mt-0.5 font-mono text-code-md leading-normal text-on-surface-variant';
const eyebrow = 'font-mono text-code-md tracking-eyebrow text-on-surface-variant';

export function HowKairoWorks() {
  return (
    <section
      id="how"
      aria-label="How Kairo works, from repo to a self-healing app"
      className="flex min-w-0 flex-[1_1_460px] scroll-mt-6 flex-col rounded-[14px] border border-surface-container-highest bg-surface-container-low p-7"
    >
      <h2 className={`mb-4.5 ${eyebrow}`}>HOW KAIRO WORKS</h2>

      <div className={`${box} flex items-center gap-3.5`}>
        <GithubMark className="size-5 shrink-0 text-on-surface" />
        <div className="min-w-0">
          <p className={title}>Your repo</p>
          <p className={detail}>Node.js or Python. No Docker or Kubernetes knowledge needed.</p>
        </div>
      </div>
      <Step>Kairo detects the stack</Step>

      <div className={`${box} flex flex-col gap-2.5`}>
        <p className={title}>Generated setup</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Generated files">
          {['Dockerfile', 'k8s manifests', 'CI workflow', 'alert rules'].map((f) => (
            <li key={f} className="rounded border border-outline-variant px-2 py-1 font-mono text-code-md text-on-surface">
              {f}
            </li>
          ))}
        </ul>
        <p className="font-mono text-code-md leading-normal text-on-surface-variant">Validated, test-built and deployed as a preview first.</p>
      </div>
      <Step>Pull request from kairo[bot]. You merge.</Step>

      <div className="flex items-stretch gap-2.5">
        <div className={`${box} min-w-0 flex-1 basis-0`}>
          <p className={title}>GitHub Actions</p>
          <p className={detail}>amd64 + arm64 images, Trivy scan</p>
        </div>
        <RightArrow />
        <div className={`${box} min-w-0 flex-1 basis-0`}>
          <p className={title}>GHCR</p>
          <p className={detail}>the new image waits here</p>
        </div>
      </div>
      <Step>Kairo rolls it out and watches it for 60 s</Step>

      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[10px] border border-tertiary-container bg-tertiary-surface px-4.5 py-4">
        <div className="min-w-0">
          <p className={title}>Running on Kubernetes</p>
          <p className={detail}>with a public link through Cloudflare Tunnel</p>
        </div>
        <span className="inline-flex items-center gap-2 font-mono text-body-md text-tertiary">
          <span className="size-2 rounded-full bg-tertiary" aria-hidden="true" />
          Live
        </span>
      </div>

      <div className="mt-4.5 flex flex-col gap-3 rounded-[10px] border border-dashed border-outline-variant p-4">
        <h3 className={eyebrow}>IF SOMETHING BREAKS</h3>
        {/* side by side, as designed; on a phone each box would be 23 px wide, so they stack */}
        <div className="flex items-stretch gap-2 max-sm:flex-col">
          <HealStep name="Alert" tone="border-error-container text-error">
            crash, out of memory, busy, slow
          </HealStep>
          <RightArrow turn />
          <HealStep name="Act" tone="border-inverse-primary text-primary">
            restart, roll back or scale
          </HealStep>
          <RightArrow turn />
          <HealStep name="Verify" tone="border-on-tertiary-fixed-variant text-tertiary">
            checked within 90 s
          </HealStep>
        </div>
        <p className="flex items-center gap-2 font-mono text-code-md leading-normal text-on-surface-variant">
          <Icon name="replay" className="shrink-0 text-[16px] text-tertiary" />
          Back to running. After 3 tries, Kairo stops and asks you.
        </p>
      </div>
    </section>
  );
}

// a down arrow with what happens between two boxes
function Step({ children }) {
  return (
    <div className="flex min-h-12 items-center gap-3.5 pl-6.5">
      <svg width="12" height="40" viewBox="0 0 12 40" aria-hidden="true" className="shrink-0 overflow-visible stroke-primary">
        <path d="M6 1 V35" fill="none" strokeWidth="2" strokeLinecap="round" />
        <path d="M1 30 L6 38 L11 30" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-mono text-code-md leading-normal text-on-surface-variant">{children}</span>
    </div>
  );
}

// `turn`: points down when the heal steps stack on a phone
function RightArrow({ turn = false }) {
  return (
    <svg
      width="28"
      height="12"
      viewBox="0 0 28 12"
      aria-hidden="true"
      className={`shrink-0 self-center overflow-visible stroke-outline ${turn ? 'max-sm:my-2 max-sm:rotate-90' : ''}`}
    >
      <path d="M1 6 H23" fill="none" strokeWidth="2" strokeLinecap="round" />
      <path d="M18 1 L26 6 L18 11" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// one step of the heal loop; `tone` is its border and title colour
function HealStep({ name, tone, children }) {
  const [border, text] = tone.split(' ');
  return (
    <div className={`min-w-0 flex-1 basis-0 rounded-lg border bg-surface-container p-3 ${border}`}>
      <p className={`text-body-xl font-semibold ${text}`}>{name}</p>
      <p className={detail}>{children}</p>
    </div>
  );
}

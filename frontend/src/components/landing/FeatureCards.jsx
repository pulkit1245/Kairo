import { Icon } from '../common/Icon.jsx';

// The four cards under the hero: what Kairo does, in order.
const FEATURES = [
  {
    icon: 'code',
    title: 'Generates',
    text: "Detects the stack and writes the Dockerfile, Kubernetes manifests, CI workflow with Trivy, and alert rules. Each file is validated before it's used.",
  },
  {
    icon: 'download',
    title: 'Ships',
    text: 'Opens a pull request from kairo[bot]. After the merge, GitHub Actions builds amd64 and arm64 images and Kairo rolls them out with a public link.',
  },
  {
    icon: 'ecg_heart',
    tone: 'text-tertiary',
    title: 'Heals',
    text: 'Restarts, rolls back or scales on alerts, verifies every action within 90 s, and stops to ask for help instead of looping.',
  },
  {
    icon: 'chat',
    title: 'Explains',
    text: 'Turns a failed build or an incident into plain words, and files a GitHub issue so the fix is never a mystery.',
  },
];

export function FeatureCards() {
  return (
    <section
      id="features"
      aria-label="What Kairo does"
      className="mx-auto mt-26 grid max-w-300 scroll-mt-6 grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4"
    >
      {FEATURES.map((f) => (
        <article key={f.title} className="flex flex-col gap-3 rounded-xl border border-surface-container-high bg-surface-container-low/70 p-6">
          <Icon name={f.icon} className={`text-[24px] ${f.tone ?? 'text-primary'}`} />
          <h2 className="text-title-md font-semibold text-on-surface-strong">{f.title}</h2>
          <p className="text-body-xl text-on-surface-variant">{f.text}</p>
        </article>
      ))}
    </section>
  );
}

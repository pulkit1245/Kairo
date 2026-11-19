import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { GithubMark } from '../components/auth/AuthCard.jsx';
import { Icon } from '../components/common/Icon.jsx';
import { FeatureCards } from '../components/landing/FeatureCards.jsx';
import { HowKairoWorks } from '../components/landing/HowKairoWorks.jsx';
import { LandingHeader } from '../components/landing/LandingHeader.jsx';
import { getMe, logout } from '../services/api.js';

// Why the backend sent the browser back here (auth.controller.js, ?error=...)
const ERRORS = {
  'not-configured': "Sign-in isn't set up on this Kairo yet: the GitHub App settings are missing.",
  cancelled: 'Sign-in was cancelled on GitHub.',
  'no-code': 'GitHub came back without a sign-in code. Try again.',
  state: 'That sign-in attempt expired or was started in another tab. Try again.',
  github: "GitHub didn't answer. Try again in a moment.",
  'sign-in-first': 'Sign in first, then connect your repos.',
  'account-mismatch': 'GitHub came back signed in as a different account than this Kairo session.',
};

// Measured in P5 on the final code: a merged push to its release live in
// 97.8 s (a reference fork's GHCR rollout), and a crash loop rolled back
// 30 s after its alert, every time (incident start to resolved).
const STATS = [
  { value: '98 s', label: 'merged push to new release live' },
  { value: '30 s', label: 'crash loop: alert to recovered' },
];

const primaryButton =
  'landing-focus inline-flex min-h-13 items-center gap-2.5 rounded-lg bg-primary px-6 text-headline-md font-semibold text-on-primary-fixed hover:brightness-110';

// The public landing page (docs/planning/design/hero). Signing in is a
// full-page redirect to GitHub (FR-1).
//   /signin: signed-out visitors only; signed in goes straight to the apps.
//   /home:   everyone; signed in, the header shows who you are (sidebar logo).
export function LandingPage({ home = false }) {
  const [params] = useSearchParams();
  const error = params.get('error');
  // undefined while asking, null when signed out, else the user
  const [me, setMe] = useState(undefined);

  useEffect(() => {
    getMe().then(setMe, () => setMe(null));
  }, []);
  if (me && !home) return <Navigate to="/" replace />;

  async function signOut() {
    try {
      await logout();
    } finally {
      window.location.assign('/home');
    }
  }

  return (
    <div className="landing-grid min-h-full px-6 pb-24 font-sans text-on-surface">
      <LandingHeader me={me} onSignOut={signOut} />

      <main id="top" className="mx-auto flex max-w-300 flex-wrap items-center gap-16 pt-22">
        <section className="flex min-w-0 flex-[1_1_480px] flex-col gap-7">
          <p className="inline-flex items-center gap-2.5 self-start rounded-full border border-surface-container-high bg-surface-container-low px-3.5 py-1.5 font-mono text-body-md text-on-surface-variant">
            <span className="size-2 shrink-0 rounded-full bg-tertiary" aria-hidden="true" />
            Zero-touch DevOps for Node and Python apps
          </p>
          <h1 className="text-display font-bold text-on-surface-strong max-[400px]:text-[52px]">
            Pick a repo.
            <br />
            <span className="text-primary">Kairo ships it</span>
            <br />
            and keeps it running.
          </h1>
          <p className="max-w-140 text-lead text-on-surface-variant">
            Kairo reads your repo, writes the Dockerfile, Kubernetes manifests, GitHub Actions workflow and alert rules, and opens a
            pull request. Once it's merged, every new image rolls out on its own. When an app crashes, runs out of memory or gets
            busy, Kairo restarts it, rolls it back or scales it, then checks that the fix worked.
          </p>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-error/40 bg-error-container/20 px-3 py-2 text-body-xl text-error">
              <Icon name="error" className="mt-0.5 text-[18px]" />
              {ERRORS[error] ?? 'Sign-in failed. Try again.'}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              {me ? (
                <Link to="/" className={primaryButton}>
                  <Icon name="space_dashboard" className="text-[20px]" />
                  Open dashboard
                </Link>
              ) : (
                // hidden, not removed, while the page asks who is signed in, so nothing jumps
                <a href="/api/auth/login" className={`${primaryButton} ${me === undefined ? 'invisible' : ''}`}>
                  <GithubMark className="size-5" />
                  Sign in with GitHub
                </a>
              )}
              <a
                href="#how"
                className="landing-focus inline-flex min-h-13 items-center gap-2 rounded-lg border border-outline-variant px-5.5 text-headline-md font-medium text-on-surface hover:bg-surface-container"
              >
                See how it works
                <Icon name="arrow_forward" className="text-[18px]" />
              </a>
            </div>
            {me === null && (
              <p className="text-body-sm text-outline">
                Kairo reads only your GitHub login and avatar. Repo access comes later, for the repos you pick.
              </p>
            )}
          </div>

          <dl className="mt-3 grid max-w-100 grid-cols-2 gap-4">
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col-reverse gap-1.5 border-t border-surface-container-highest pt-4">
                <dt className="text-body-md text-on-surface-variant">{s.label}</dt>
                <dd className="font-mono text-stat font-semibold text-on-surface-strong">{s.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <HowKairoWorks />
      </main>

      <FeatureCards />
    </div>
  );
}

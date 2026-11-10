import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { AuthCard, GithubMark } from '../components/auth/AuthCard.jsx';
import { Icon } from '../components/common/Icon.jsx';
import { getMe } from '../services/api.js';

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

// Stitch screen 01. Signing in is a full-page redirect to GitHub (FR-1).
export function SignInPage() {
  const [params] = useSearchParams();
  const error = params.get('error');
  const [signedIn, setSignedIn] = useState(false);

  // already signed in: straight to the apps
  useEffect(() => {
    getMe().then(() => setSignedIn(true), () => {});
  }, []);
  if (signedIn) return <Navigate to="/" replace />;

  return (
    <AuthCard>
      <h1 className="text-center text-headline-lg font-semibold">Deploy a repo. Kairo keeps it running.</h1>
      <p className="mt-3 text-center text-body-lg text-on-surface-variant">
        Kairo writes the Dockerfile, Kubernetes files and pipeline, deploys your app and heals it when it breaks.
      </p>

      {error && (
        <p role="alert" className="mt-6 flex items-start gap-2 rounded border border-error/40 bg-error-container/20 px-3 py-2 text-body-md text-error">
          <Icon name="error" className="mt-0.5 text-[16px]" />
          {ERRORS[error] ?? 'Sign-in failed. Try again.'}
        </p>
      )}

      <a
        href="/api/auth/login"
        className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg bg-primary-container px-4 py-3 text-body-lg font-semibold text-on-primary-container shadow-lg shadow-primary-container/20 hover:brightness-110"
      >
        <GithubMark />
        Sign in with GitHub
      </a>

      <p className="mt-6 text-center text-body-sm text-on-surface-variant">
        Kairo reads your GitHub login and avatar. Repo access comes later from the Kairo GitHub App, and only for repos you pick.
      </p>
    </AuthCard>
  );
}

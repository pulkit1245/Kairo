import { Link, useSearchParams } from 'react-router';
import { AuthCard, GithubMark } from '../components/auth/AuthCard.jsx';
import { Icon } from '../components/common/Icon.jsx';

// Stitch screen 02: GitHub said who you are, but that login isn't in
// ALLOWED_GITHUB_LOGINS (FR-2). Nothing was stored about you.
export function NotInvitedPage() {
  const [params] = useSearchParams();
  const login = params.get('login');

  return (
    <AuthCard>
      <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
        <Icon name="lock" className="text-[22px] text-warning" />
        <div>
          <h1 className="text-body-lg font-semibold text-warning">You're not on the team list yet</h1>
          <p className="mt-1 text-body-md text-warning/90">
            Kairo is open to invited team members only.{' '}
            {login ? (
              <>
                The GitHub account{' '}
                <code className="rounded border border-warning/40 px-1 font-mono text-code-md">@{login}</code> isn't on the list.
              </>
            ) : (
              "This GitHub account isn't on the list."
            )}
          </p>
        </div>
      </div>

      <p className="mt-6 text-center text-body-md text-on-surface-variant">
        Ask a Kairo admin to add your GitHub username, then sign in again.
      </p>

      <a
        href="/api/auth/login"
        className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-outline-variant bg-surface-container-high px-4 py-3 text-body-lg hover:bg-surface-container-highest"
      >
        <GithubMark />
        Sign in with a different account
      </a>
      <p className="mt-2 text-center text-body-sm text-outline">
        Sign out of github.com first, or GitHub signs you in as the same account again.
      </p>

      <Link to="/signin" className="mt-6 block text-center text-body-md text-on-surface-variant hover:text-on-surface">
        Back to sign in
      </Link>
    </AuthCard>
  );
}

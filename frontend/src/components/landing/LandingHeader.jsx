import { Icon } from '../common/Icon.jsx';
import { AccountMenu } from './AccountMenu.jsx';

export const REPO_URL = 'https://github.com/PunitXd/kairo-up';
const link = 'landing-focus rounded text-on-surface-variant hover:text-on-surface';

// The landing page's top bar. `me` is undefined while the page asks who is
// signed in (nothing on the right yet), null when signed out, else the user.
export function LandingHeader({ me, onSignOut }) {
  return (
    <header className="mx-auto flex max-w-300 flex-wrap items-center justify-between gap-4 border-b border-surface-container-high py-6">
      <a href="#top" className="landing-focus flex items-center gap-3 rounded-lg text-on-surface">
        <span className="grid size-10 place-items-center rounded-lg bg-primary text-on-primary">
          <Icon name="deployed_code" className="text-[24px]" />
        </span>
        <span className="text-headline-lg font-semibold">Kairo</span>
      </a>
      <nav aria-label="Main" className="flex flex-wrap items-center gap-x-7 gap-y-2 text-body-xl">
        <a href="#how" className={link}>
          How it works
        </a>
        <a href="#features" className={link}>
          Features
        </a>
        <a href={REPO_URL} className={link}>
          GitHub
        </a>
        {me === null && (
          <a
            href="/api/auth/login"
            className="landing-focus inline-flex min-h-11 items-center rounded-lg border border-outline-variant px-4.5 font-medium text-on-surface hover:bg-surface-container"
          >
            Sign in
          </a>
        )}
        {me && <AccountMenu user={me} onSignOut={onSignOut} />}
        {me === undefined && <span className="min-h-11 w-24" aria-hidden="true" />}
      </nav>
    </header>
  );
}

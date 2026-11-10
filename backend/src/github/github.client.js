import { readFileSync } from 'node:fs';
import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { env } from '../config/env.config.js';
import { createLogger } from '../utils/logger.js';

// The one place that talks to GitHub, as the Kairo GitHub App (FR-1 to FR-6).
// Like kubernetes/, both generator/ and remediation/ may import it.
//
// Three kinds of credentials, none of them stored:
//   - the App's JWT, signed with the private key, for app-level calls
//   - installation tokens, for one installation's repos (FR-5)
//   - a user's token, only during sign-in, then revoked

// FR-5: installation tokens are minted per use and never kept. @octokit/auth-app
// normally keeps them in an in-memory cache for up to an hour; this cache
// remembers nothing, so every request mints a fresh token and no token outlives
// the request that used it. Never replace it with a real cache.
export const NO_TOKEN_CACHE = Object.freeze({
  get: async () => undefined,
  set: async () => {},
});

const USER_AGENT = 'kairo';

// Octokit logs every failed request itself, even the 404s Kairo expects (e.g.
// "no kairo/setup branch yet"). Kairo handles and logs real errors where they
// happen, so Octokit's own lines go to debug.
const ghLog = createLogger('github');
const OCTOKIT_LOG = {
  debug: () => {},
  info: () => {},
  warn: (m) => ghLog.debug(m),
  error: (m) => ghLog.debug(m),
};
const options = (extra) => ({ userAgent: USER_AGENT, log: OCTOKIT_LOG, ...extra });

// read once, when first needed. The key stays in memory, never in the database
// or a log (PQ8: Punit keeps the file at GITHUB_APP_PRIVATE_KEY_PATH)
let privateKey;
function appPrivateKey() {
  if (!privateKey) {
    try {
      privateKey = readFileSync(env.github.privateKeyPath, 'utf8');
    } catch {
      throw new Error(`GitHub App private key not found at ${env.github.privateKeyPath}`);
    }
  }
  return privateKey;
}

function appAuthOptions() {
  return {
    appId: env.github.appId,
    privateKey: appPrivateKey(),
    clientId: env.github.clientId,
    clientSecret: env.github.clientSecret,
    cache: NO_TOKEN_CACHE,
  };
}

// app-level calls (JWT), and the OAuth token routes (client id + secret)
function appClient() {
  return new Octokit(options({ authStrategy: createAppAuth, auth: appAuthOptions() }));
}

// calls on one installation's repos. Each request mints its own token (see NO_TOKEN_CACHE)
export function installationClient(githubInstallationId) {
  return new Octokit(
    options({ authStrategy: createAppAuth, auth: { ...appAuthOptions(), installationId: githubInstallationId } }),
  );
}

// GitHub's "Sign in with GitHub" page for the App's user authorization (FR-1)
export function authorizeUrl(state) {
  const q = new URLSearchParams({
    client_id: env.github.clientId,
    redirect_uri: `${env.appUrl}/api/auth/callback`,
    state,
  });
  return `https://github.com/login/oauth/authorize?${q}`;
}

// the App's install page (FR-3). It also lets you change which repos an
// existing installation can see
export function installUrl(state) {
  return `https://github.com/apps/${env.github.appSlug}/installations/new?state=${encodeURIComponent(state)}`;
}

// Turns the code from the callback into who the user is and which Kairo
// installations they can reach. The user token lives only inside this function
// and is revoked before it returns.
export async function exchangeCode(code) {
  const { token } = await createAppAuth(appAuthOptions())({ type: 'oauth-user', code });
  try {
    const user = new Octokit(options({ auth: token }));
    const { data: me } = await user.rest.users.getAuthenticated();
    const installations = await user.paginate(user.rest.apps.listInstallationsForAuthenticatedUser, {
      per_page: 100,
    });
    return {
      user: { githubId: me.id, login: me.login, avatarUrl: me.avatar_url ?? null },
      // a GitHub App user token only sees this App's installations; the filter is belt and braces
      installations: installations
        .filter((i) => String(i.app_id) === String(env.github.appId))
        .map((i) => ({ githubInstallationId: i.id, accountLogin: i.account?.login ?? 'unknown' })),
    };
  } finally {
    await revokeUserToken(token);
  }
}

async function revokeUserToken(token) {
  try {
    await appClient().request('DELETE /applications/{client_id}/token', {
      client_id: env.github.clientId,
      access_token: token,
    });
  } catch {
    // it expires on its own; sign-in shouldn't fail over this
  }
}

/**
 * @returns {Promise<Array<{ fullName: string, private: boolean, defaultBranch: string, pushedAt: string | null, htmlUrl: string }>>}
 */
export async function listInstallationRepos(githubInstallationId) {
  const gh = installationClient(githubInstallationId);
  const repos = await gh.paginate(gh.rest.apps.listReposAccessibleToInstallation, { per_page: 100 });
  return repos.map(toRepo);
}

// null when this installation can't see the repo
export async function getInstallationRepo(githubInstallationId, owner, repo) {
  try {
    const { data } = await installationClient(githubInstallationId).rest.repos.get({ owner, repo });
    return toRepo(data);
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

// The newest commit on a branch, for the GHCR watcher (FR-35)
/** @returns {Promise<{ sha: string, message: string }>} */
export async function getBranchHead(githubInstallationId, owner, repo, branch) {
  const { data } = await installationClient(githubInstallationId).rest.repos.getBranch({ owner, repo, branch });
  return { sha: data.commit.sha, message: data.commit.commit.message.split('\n')[0] };
}

function toRepo(r) {
  return {
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    pushedAt: r.pushed_at ?? null,
    htmlUrl: r.html_url,
  };
}

// minting a token for an uninstalled (or suspended) installation fails with
// 404 or 403: the installation should be marked suspended
export const isInstallationGone = (err) => err?.status === 404 || err?.status === 403;

// one readable line, without request details (Octokit already redacts tokens)
export function githubErrorMessage(err) {
  if (err?.status) return `GitHub API ${err.status}: ${String(err.message).split('\n')[0]}`;
  return err instanceof Error ? err.message : String(err);
}

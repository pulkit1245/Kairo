import { env } from '../config/env.config.js';
import { prisma } from '../db/index.js';
import { exchangeCode } from '../github/github.client.js';
import { isAllowed } from '../utils/session.js';

// Sign-in and the return from installing the App (FR-1 to FR-3).
// GitHub sends both to /api/auth/callback with a code; the controller decides
// which one it is and handles cookies and redirects.

/**
 * Exchanges the code, checks the allow-list, stores the user and their
 * installations. Returns what the controller needs to answer.
 * @returns {Promise<
 *   | { outcome: 'not-invited', login: string }
 *   | { outcome: 'signed-in', user: { id: string, login: string, githubId: number }, installationIds: number[] }
 * >}
 */
export async function completeSignIn(code) {
  const { user: gh, installations } = await exchangeCode(code);

  // FR-2: nothing is stored for someone who isn't invited
  if (!isAllowed(gh.login, env.allowedLogins)) return { outcome: 'not-invited', login: gh.login };

  const user = await prisma.user.upsert({
    where: { githubId: gh.githubId },
    create: { githubId: gh.githubId, login: gh.login, avatarUrl: gh.avatarUrl },
    update: { login: gh.login, avatarUrl: gh.avatarUrl },
  });

  // every installation GitHub says this user can reach. An install that was
  // suspended and is back gets un-suspended. The first user to bring an
  // installation owns it (one owner per installation, see the P2 note)
  for (const inst of installations) {
    await prisma.installation.upsert({
      where: { githubInstallationId: inst.githubInstallationId },
      create: { ...inst, userId: user.id },
      update: { accountLogin: inst.accountLogin, suspendedAt: null },
    });
  }

  return {
    outcome: 'signed-in',
    user: { id: user.id, login: user.login, githubId: user.githubId },
    installationIds: installations.map((i) => i.githubInstallationId),
  };
}

export async function currentUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { installations: { where: { suspendedAt: null }, orderBy: { createdAt: 'asc' } } },
  });
  if (!user) return null;
  return {
    login: user.login,
    avatarUrl: user.avatarUrl,
    installUrl: '/api/auth/install',
    installations: user.installations.map((i) => ({ id: i.id, accountLogin: i.accountLogin })),
  };
}

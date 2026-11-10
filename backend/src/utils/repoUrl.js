import { AppError } from './AppError.js';

// only public github https urls for now, that's all the demo needs
const GITHUB_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

export function parseGithubUrl(input) {
  const match = GITHUB_URL.exec(input.trim());
  if (!match) {
    throw new AppError('Expected a GitHub URL like https://github.com/owner/repo');
  }
  const owner = match[1];
  const repo = match[2];
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

// the app name becomes the Deployment + Service name in k8s.
// Services are stricter than Deployments (DNS-1035): lowercase alphanumerics and '-',
// must START with a letter, end with alphanumeric, max 63 chars
export function toAppName(repo) {
  let name = repo
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // repo named something like "___" would end up empty
  if (!name) return 'app';
  if (/^[0-9]/.test(name)) name = `app-${name}`;

  return name.slice(0, 50).replace(/-$/, '');
}

// apps store "owner/repo"; this is what git clones
export function cloneUrlFor(repoFullName) {
  return `https://github.com/${repoFullName}.git`;
}

// slug = k8s name, app label and <slug>.kairo.local, so it must be unique.
// Try the repo name, then owner-repo, then add -2, -3 ...
// isTaken is async (slug) => boolean, passed in so this stays testable
export async function pickSlug(owner, repo, isTaken) {
  const first = toAppName(repo);
  if (!(await isTaken(first))) return first;

  const withOwner = toAppName(`${owner}-${repo}`);
  if (!(await isTaken(withOwner))) return withOwner;

  for (let n = 2; ; n++) {
    const candidate = `${withOwner.slice(0, 46)}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}

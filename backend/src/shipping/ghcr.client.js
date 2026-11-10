import { createLogger } from '../utils/logger.js';

// Reads GHCR the way the cluster pulls from it: anonymously (P0 spike, PQ3).
// Decision 3 of the P2 plan: the registry API, not GitHub's Packages API. It
// proves the image is pullable, needs no token of ours, and shows which
// architectures the image index holds.
//
// The pull token GHCR hands out here is anonymous and short-lived, but it is
// still never logged.

const log = createLogger('ghcr');

const REGISTRY = 'https://ghcr.io';
const TIMEOUT_MS = 10_000;

// FR-24: the laptop is arm64 and the workflow builds both. An amd64-only image
// would fail on the laptop with an exec-format error
export const REQUIRED_PLATFORMS = ['linux/amd64', 'linux/arm64'];

const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

// "owner/repo" as GHCR names it: lower case (P0 spike)
const imageName = (repoFullName) => repoFullName.toLowerCase();

/**
 * The platforms in a manifest. An image index lists one manifest per platform;
 * Buildx adds attestation manifests with platform unknown/unknown, skipped here.
 * A single-platform manifest has no list: it holds one architecture we can't
 * name without another request, so it counts as incomplete.
 * @returns {string[]} e.g. ['linux/amd64', 'linux/arm64']
 */
export function platformsOf(manifest) {
  if (!Array.isArray(manifest?.manifests)) return [];
  return manifest.manifests
    .map((m) => m.platform)
    .filter((p) => p && p.os !== 'unknown' && p.architecture !== 'unknown')
    .map((p) => `${p.os}/${p.architecture}${p.variant && p.architecture !== 'arm64' ? `/${p.variant}` : ''}`);
}

export const missingPlatforms = (platforms) => REQUIRED_PLATFORMS.filter((p) => !platforms.includes(p));

/**
 * Is `ghcr.io/<repo>:<tag>` there, and for which platforms?
 * @returns {Promise<{ found: false, detail: string } | { found: true, platforms: string[], missing: string[] }>}
 */
export async function findImage(repoFullName, tag, fetchImpl = fetch) {
  const name = imageName(repoFullName);
  const tokenRes = await fetchImpl(`${REGISTRY}/token?scope=repository:${name}:pull`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 401/403 until the first push creates the package (or if it isn't public)
  if (!tokenRes.ok) return { found: false, detail: `no public package ghcr.io/${name} yet (${tokenRes.status})` };
  const { token } = await tokenRes.json();

  const res = await fetchImpl(`${REGISTRY}/v2/${name}/manifests/${tag}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 404) return { found: false, detail: `no tag ${tag.slice(0, 7)} yet` };
  if (!res.ok) {
    log.debug(`manifest ${name}:${tag.slice(0, 7)} -> ${res.status}`);
    return { found: false, detail: `GHCR answered ${res.status}` };
  }
  const platforms = platformsOf(await res.json());
  return { found: true, platforms, missing: missingPlatforms(platforms) };
}

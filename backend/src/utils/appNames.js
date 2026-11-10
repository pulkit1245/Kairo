// Names derived from an app's slug, in one place so the pipeline, the templates
// and remediation always agree (P1 contract: kairo-<slug>, <slug>.kairo.local).

// one namespace per app (FR-29). slugs are at most 50 characters, so this stays
// under Kubernetes' 63-character limit
export const appNamespace = (slug) => `kairo-${slug}`;

// Traefik routes this host to the app (FR-23)
export const appHost = (slug) => `${slug}.kairo.local`;

// built by Docker Desktop's engine, which the kubeadm cluster reads directly (FR-27).
// full commit sha as the tag (FR-22, M21); the UI shows 7 characters
export const appImage = (slug, commitSha) => `kairo/${slug}:${commitSha}`;

// where the generated workflow pushes (FR-24): GHCR rejects upper case, so the
// repo name is lowered (P0 spike). The tag is the full commit sha
export const ghcrImage = (repoFullName) => `ghcr.io/${repoFullName.toLowerCase()}`;

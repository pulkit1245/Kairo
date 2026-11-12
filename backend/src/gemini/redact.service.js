// Removes secrets from text before it goes to Gemini (FR-18, FR-53): tokens,
// keys and passwords, matched by pattern. What goes out is still useful for
// explaining a failure; the secret part becomes [redacted].

const R = '[redacted]';

const PATTERNS = [
  // private key blocks, whole
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, R],
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, R],
  // Google API keys, AWS access keys, Slack and Stripe-style tokens
  [/\bAIza[0-9A-Za-z_-]{30,}/g, R],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}/g, R],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, R],
  // JSON web tokens
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  // Authorization headers
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${R}`],
  // user:password@ in URLs
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${R}@`],
  // name=value or "name": "value" where the name sounds secret
  [
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|auth)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;}]{3,})/gi,
    `$1$2${R}`,
  ],
];

export function redact(text) {
  if (!text) return text ?? '';
  let out = String(text);
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

// file names that are never sent, not even their path (FR-18)
export function isSecretFile(rel) {
  const name = rel.split('/').at(-1).toLowerCase();
  return (
    name.startsWith('.env') ||
    /\.(pem|key|p12|pfx|jks|keystore|crt|cer)$/.test(name) ||
    /^id_(rsa|dsa|ecdsa|ed25519)/.test(name) ||
    ['.npmrc', '.pypirc', '.netrc', 'credentials', 'credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml'].includes(name)
  );
}

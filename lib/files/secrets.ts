/**
 * Credentials left in files: API keys, tokens, private keys and passwords
 * in source code, config files, logs and exports, found before the files
 * are shared, published or committed.
 *
 * Most services give their keys a recognisable shape - AWS's start AKIA,
 * GitHub's ghp_, Stripe's sk_live_ - so each pattern here matches one
 * provider's format rather than guessing from randomness, which keeps the
 * false alarms down. A few broader patterns catch the rest: a private key
 * block, a JSON Web Token, a database URL with a password in it, and a
 * variable named like a secret assigned a literal. Those are marked as
 * less certain.
 */

export type Confidence = "high" | "medium";

interface Rule {
  id: string;
  label: string;
  pattern: RegExp;
  confidence: Confidence;
  /** Which capture group is the secret itself; the whole match when absent. */
  group?: number;
  /** A last check on the secret, for rules whose shape alone is not enough. */
  accept?: (secret: string) => boolean;
}

/** Values that are clearly placeholders in documentation and templates. */
const PLACEHOLDER = /^(x+|\*+|\.+|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%[^%]*%|your[_-]?\w*|changeme|change[_-]me|example\w*|placeholder|dummy|test|secret|password|null|none|undefined|redacted|\[redacted\])$/i;

function notPlaceholder(secret: string): boolean {
  return !PLACEHOLDER.test(secret) && !/^(.)\1+$/.test(secret) && !/(xxxx|0000000|1234567|abcdefg)/i.test(secret);
}

export const RULES: readonly Rule[] = [
  { id: "private-key", label: "Private key", pattern: /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?)-----/g, confidence: "high" },
  { id: "aws-access-key", label: "AWS access key ID", pattern: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g, confidence: "high", group: 1 },
  { id: "aws-secret-key", label: "AWS secret access key", pattern: /aws.{0,20}?(?:secret|private).{0,20}?[=:]\s*["']?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])/gi, confidence: "high", group: 1 },
  { id: "github-token", label: "GitHub token", pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g, confidence: "high", group: 1 },
  { id: "github-fine-grained", label: "GitHub fine-grained token", pattern: /\b(github_pat_[A-Za-z0-9_]{80,})\b/g, confidence: "high", group: 1 },
  { id: "gitlab-token", label: "GitLab token", pattern: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g, confidence: "high", group: 1 },
  { id: "slack-token", label: "Slack token", pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, confidence: "high", group: 1 },
  { id: "slack-webhook", label: "Slack webhook", pattern: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+)/g, confidence: "high", group: 1 },
  { id: "discord-webhook", label: "Discord webhook", pattern: /(https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+)/g, confidence: "high", group: 1 },
  { id: "stripe-key", label: "Stripe secret key", pattern: /\b((?:sk|rk)_live_[A-Za-z0-9]{24,})\b/g, confidence: "high", group: 1 },
  { id: "stripe-test-key", label: "Stripe test key", pattern: /\b((?:sk|rk)_test_[A-Za-z0-9]{24,})\b/g, confidence: "medium", group: 1 },
  { id: "google-api-key", label: "Google API key", pattern: /\b(AIza[0-9A-Za-z_-]{35})(?![0-9A-Za-z_-])/g, confidence: "high", group: 1 },
  { id: "google-oauth-secret", label: "Google OAuth client secret", pattern: /\b(GOCSPX-[A-Za-z0-9_-]{28})\b/g, confidence: "high", group: 1 },
  { id: "openai-key", label: "OpenAI API key", pattern: /\b(sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{80,})(?![A-Za-z0-9_-])/g, confidence: "high", group: 1 },
  { id: "anthropic-key", label: "Anthropic API key", pattern: /\b(sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,})(?![A-Za-z0-9_-])/g, confidence: "high", group: 1 },
  { id: "huggingface-token", label: "Hugging Face token", pattern: /\b(hf_[A-Za-z0-9]{34,})\b/g, confidence: "high", group: 1 },
  { id: "twilio-key", label: "Twilio API key", pattern: /\b(SK[0-9a-f]{32})\b/g, confidence: "medium", group: 1 },
  { id: "sendgrid-key", label: "SendGrid API key", pattern: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g, confidence: "high", group: 1 },
  { id: "mailgun-key", label: "Mailgun API key", pattern: /\b(key-[0-9a-f]{32})\b/g, confidence: "medium", group: 1 },
  { id: "npm-token", label: "npm token", pattern: /\b(npm_[A-Za-z0-9]{36})\b/g, confidence: "high", group: 1 },
  { id: "pypi-token", label: "PyPI token", pattern: /\b(pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,})/g, confidence: "high", group: 1 },
  { id: "shopify-token", label: "Shopify access token", pattern: /\b(shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32})\b/g, confidence: "high", group: 1 },
  { id: "telegram-bot", label: "Telegram bot token", pattern: /\b(\d{8,10}:AA[A-Za-z0-9_-]{33})\b/g, confidence: "high", group: 1 },
  { id: "azure-storage", label: "Azure storage account key", pattern: /AccountKey=([A-Za-z0-9+/]{86}==)/g, confidence: "high", group: 1 },
  { id: "jwt", label: "JSON Web Token", pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, confidence: "medium", group: 1 },
  { id: "database-url", label: "Database URL with a password", pattern: /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|sqlserver):\/\/[^\s:/@'"]+:([^\s@/'"]+)@[^\s/'"]+)/g, confidence: "high", group: 1, accept: (secret) => notPlaceholder(secret.replace(/^[^:]+:\/\/[^:]+:([^@]+)@.*$/, "$1")) },
  {
    id: "assigned-secret",
    label: "Secret assigned in code or config",
    pattern: /\b[\w.-]*?(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)[\w.-]*\s*(?:=|:|=>)\s*["']([^"'\s]{8,})["']/gi,
    confidence: "medium",
    group: 1,
    accept: notPlaceholder,
  },
];

export interface Finding {
  rule: string;
  label: string;
  confidence: Confidence;
  line: number;
  column: number;
  /** The secret with its middle hidden, for a report that is safe to share. */
  preview: string;
}

/** The start and end of a secret shown, the middle starred, so a report does not leak what it found. */
export function redact(secret: string): string {
  if (secret.length <= 8) return `${secret.slice(0, 2)}${"*".repeat(Math.max(0, secret.length - 2))}`;
  const keep = Math.min(6, Math.floor(secret.length / 5));
  return `${secret.slice(0, keep)}${"*".repeat(Math.min(12, secret.length - keep * 2))}${secret.slice(-keep)}`;
}

/** Every credential in a text, each once, in the order it appears. */
export function scanText(text: string): Finding[] {
  const lineStarts = [0];
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", index + 1)) lineStarts.push(index + 1);
  const position = (offset: number) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: offset - lineStarts[low] + 1 };
  };
  const findings: (Finding & { offset: number })[] = [];
  const claimed: [number, number][] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (let match = rule.pattern.exec(text); match; match = rule.pattern.exec(text)) {
      const secret = rule.group ? match[rule.group] : match[0];
      if (!secret || (rule.accept && !rule.accept(secret))) continue;
      const offset = match.index + match[0].indexOf(secret);
      // A token already reported by a more specific rule is not reported again by a broader one.
      if (claimed.some(([start, end]) => offset < end && offset + secret.length > start)) continue;
      claimed.push([offset, offset + secret.length]);
      findings.push({ rule: rule.id, label: rule.label, confidence: rule.confidence, ...position(offset), preview: rule.id === "private-key" ? secret : redact(secret), offset });
    }
  }
  return findings.sort((a, b) => a.offset - b.offset).map((finding) => ({ rule: finding.rule, label: finding.label, confidence: finding.confidence, line: finding.line, column: finding.column, preview: finding.preview }));
}

/** "GitHub token (3), private key": what was found, the commonest kinds first. */
export function summarizeFindings(findings: readonly Finding[]): string {
  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.label, (counts.get(finding.label) ?? 0) + 1);
  // The generic kinds read in lower case mid-sentence; a provider's name keeps its capital.
  const lower = (label: string) => (/^(Private|Secret|Database) /.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count], index) => `${index === 0 ? label : lower(label)}${count > 1 ? ` (${count})` : ""}`)
    .join(", ");
}

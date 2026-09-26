import { createHash, randomBytes, randomInt } from 'node:crypto';

export function newApiKey(): string {
  return `bw_${randomBytes(12).toString('hex')}`;
}

export const API_KEY_RE = /^bw_[0-9a-f]{24}$/;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function randomId(prefix: string, bytes = 6): string {
  return `${prefix}${randomBytes(bytes).toString('hex')}`;
}

/** Builder slug: lowercased, spaces → '-'. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/ /g, '-');
}

export const BUILDER_NAME_RE = /^[a-zA-Z0-9 _-]{3,32}$/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

const CODE_WORDS = [
  'reef', 'anvil', 'cairn', 'ember', 'fjord', 'gable', 'harbor', 'ingot', 'jetty', 'kiln',
  'lintel', 'mortar', 'nave', 'oriel', 'plinth', 'quarry', 'rafter', 'spire', 'tower', 'umber',
  'vault', 'wharf', 'yard', 'zenith', 'arch', 'beacon', 'column', 'dome', 'eave', 'forge',
];

export function verificationCode(): string {
  const a = CODE_WORDS[randomInt(CODE_WORDS.length)];
  const b = CODE_WORDS[randomInt(CODE_WORDS.length)];
  const digits = String(randomInt(10000)).padStart(4, '0');
  return `${a}-${b}-${digits}`;
}

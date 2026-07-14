import { createHash } from 'node:crypto';

const PREFIX = 'sk-';
const KEYSTREAM = createHash('sha256').update('docket::nine-tailed-fox::v1').digest();

function shift(value: string, direction: 1 | -1): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const digit = parseInt(value[i], 16);
    if (Number.isNaN(digit)) {
      out += value[i];
      continue;
    }
    const offset = KEYSTREAM[i % KEYSTREAM.length] % 16;
    out += ((digit + direction * offset + 16) % 16).toString(16);
  }
  return out;
}

export function encodeDocketKey(realKey: string): string {
  const suffix = realKey.startsWith(PREFIX) ? realKey.slice(PREFIX.length) : realKey;
  return PREFIX + shift(suffix, 1);
}

export function decodeDocketKey(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const suffix = value.startsWith(PREFIX) ? value.slice(PREFIX.length) : value;
  return PREFIX + shift(suffix, -1);
}

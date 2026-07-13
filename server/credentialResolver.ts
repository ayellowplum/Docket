import type { BlockedKind, FieldType } from '../shared/types.ts';
import { getCredential, isDomainAllowed, resolveProfileField } from './vault.ts';

export type ResolveResult =
  | { ok: true; value: string }
  | { ok: false; block: { kind: BlockedKind; reason: string } };

export function resolveField(field: FieldType, domain: string): ResolveResult {
  if (field === 'password') {
    const cred = getCredential(domain);
    if (cred) {
      if (!isDomainAllowed(domain)) {
        return {
          ok: false,
          block: {
            kind: 'domain_permission',
            reason: `Allow Docket to use your saved ${domain} credentials?`,
          },
        };
      }
      return { ok: true, value: cred.password };
    }
    const preferred = resolveProfileField('password');
    if (preferred) return { ok: true, value: preferred };
    return {
      ok: false,
      block: {
        kind: 'password_setup',
        reason: 'This form needs a password, but none is saved yet.',
      },
    };
  }

  if (field === 'email') {
    const cred = getCredential(domain);
    if (cred && isDomainAllowed(domain)) return { ok: true, value: cred.username };
  }

  const value = resolveProfileField(field);
  if (value) return { ok: true, value };

  return {
    ok: false,
    block: { kind: 'credential', reason: `No ${field} saved in your profile.` },
  };
}

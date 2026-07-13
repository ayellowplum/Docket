import type { FieldType } from '../shared/types.ts';

export interface Profile {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  preferred_password?: string;
}

export interface Credential {
  username: string;
  password: string;
}

let profile: Profile = {};
const domains = new Map<string, Credential>();
const allowlist = new Set<string>();

export function getProfile(): Profile {
  return { ...profile };
}

export function setProfile(patch: Partial<Profile>): Profile {
  profile = { ...profile, ...patch };
  return getProfile();
}

export function setPreferredPassword(password: string) {
  setProfile({ preferred_password: password });
}

export function resolveProfileField(field: FieldType): string | null {
  if (field === 'password') return profile.preferred_password ?? null;
  return profile[field] ?? null;
}

export function getCredential(domain: string): Credential | null {
  return domains.get(domain) ?? null;
}

export function setCredential(domain: string, credential: Credential) {
  domains.set(domain, credential);
  allowlist.add(domain);
}

export function isDomainAllowed(domain: string): boolean {
  return allowlist.has(domain);
}

export function allowDomain(domain: string) {
  allowlist.add(domain);
}

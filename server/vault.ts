import fs from 'node:fs';
import path from 'node:path';
import type { FieldType } from '../shared/types.ts';

export interface Profile {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  location?: string;
  preferred_password?: string;
}

export interface Credential {
  username: string;
  password: string;
}

export interface MemoryEntry {
  id: string;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

let profile: Profile = {};
const domains = new Map<string, Credential>();
const allowlist = new Set<string>();
let memories: MemoryEntry[] = [];
const MEMORY_FILE = path.join(process.cwd(), 'server/.data/memory.json');

loadMemory();

export function getProfile(): Profile {
  return { ...profile };
}

export function setProfile(patch: Partial<Profile>): Profile {
  profile = { ...profile, ...patch };
  saveMemory();
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

export function listMemories(): MemoryEntry[] {
  return [...memories].sort((a, b) => a.key.localeCompare(b.key));
}

export function remember(key: string, value: string): MemoryEntry {
  const cleanKey = key.trim().slice(0, 80);
  const cleanValue = value.trim().slice(0, 600);
  if (!cleanKey || !cleanValue) throw new Error('Memory key and value are required');
  const now = Date.now();
  const existing = memories.find((memory) => memory.key.toLowerCase() === cleanKey.toLowerCase());
  if (existing) {
    existing.key = cleanKey;
    existing.value = cleanValue;
    existing.updatedAt = now;
    saveMemory();
    return existing;
  }
  const entry = { id: `mem_${now.toString(36)}_${memories.length.toString(36)}`, key: cleanKey, value: cleanValue, createdAt: now, updatedAt: now };
  memories.push(entry);
  saveMemory();
  return entry;
}

export function forgetMemory(query: string): MemoryEntry[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const removed = memories.filter((memory) => memory.key.toLowerCase().includes(q) || memory.value.toLowerCase().includes(q));
  memories = memories.filter((memory) => !removed.includes(memory));
  if (removed.length) saveMemory();
  return removed;
}

export function memoryContext(): string {
  const entries = listMemories();
  const profileEntries = [
    profile.name ? `name: ${profile.name}` : '',
    profile.email ? `email: ${profile.email}` : '',
    profile.phone ? `phone: ${profile.phone}` : '',
    profile.address ? `address: ${profile.address}` : '',
    profile.location ? `location: ${profile.location}` : '',
  ].filter(Boolean);
  const memoryEntries = entries.map((memory) => `${memory.key}: ${memory.value}`);
  return [...profileEntries, ...memoryEntries].join('\n');
}

function loadMemory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')) as { profile?: Profile; memories?: MemoryEntry[] };
    profile = parsed.profile ?? {};
    memories = Array.isArray(parsed.memories) ? parsed.memories : [];
  } catch {
    profile = {};
    memories = [];
  }
}

function saveMemory() {
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify({ profile, memories }, null, 2));
}

import type { Page } from 'playwright';
import type { ManifestElement } from '../shared/types.ts';

// ---- DOM → numbered manifest of interactive elements ----
const EXTRACTOR = `() => {
  const sel = 'a,button,input,textarea,select,[role=button],[role=link],[role=textbox],[role=checkbox],[contenteditable=true]';
  const out = [];
  let id = 0;
  const seen = new Set();
  document.querySelectorAll('[data-docket-ref]').forEach((n) => n.removeAttribute('data-docket-ref'));
  for (const node of document.querySelectorAll(sel)) {
    const r = node.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none' || +style.opacity === 0) continue;
    const tag = node.tagName.toLowerCase();
    const role =
      node.getAttribute('role') ||
      (tag === 'a' ? 'link'
        : tag === 'button' ? 'button'
        : tag === 'select' ? 'select'
        : (tag === 'input' || tag === 'textarea') ? 'textbox'
        : 'button');
    const label = (
      node.getAttribute('aria-label') ||
      node.getAttribute('placeholder') ||
      node.value ||
      node.innerText ||
      node.getAttribute('name') ||
      node.getAttribute('title') ||
      ''
    ).trim().slice(0, 80);
    const key = role + '|' + label + '|' + Math.round(r.x) + '|' + Math.round(r.y);
    if (seen.has(key)) continue;
    seen.add(key);
    node.setAttribute('data-docket-ref', String(id));
    out.push({
      id,
      role,
      label,
      bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
    });
    id++;
  }
  return out;
}`;

export async function extractManifest(page: Page): Promise<ManifestElement[]> {
  const result = (await page.evaluate(`(${EXTRACTOR})()`)) as ManifestElement[] | undefined;
  return result ?? [];
}

// ---- Captcha detection ----
const CAPTCHA_PROBE = `() => {
  const frames = 'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile,#captcha';
  if (document.querySelector(frames)) return true;
  const text = (document.title + ' ' + (document.body?.innerText || '').slice(0, 1500)).toLowerCase();
  return /verify you are human|i'm not a robot|unusual traffic from your|complete the captcha|checking your browser/.test(text);
}`;

export async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    return Boolean(await page.evaluate(`(${CAPTCHA_PROBE})()`));
  } catch {
    return false;
  }
}

export function selectorForId(id: number): string {
  return `[data-docket-ref="${id}"]`;
}

import { createHmac } from 'node:crypto';

export interface PlatformNotice {
  text: string;
  sig: string;
}

export const STANDING_NOTICE = 'The Commons welcomes unclaimed builders. The world remembers everything.';

export function sign(text: string, secret: string): string {
  return createHmac('sha256', secret).update(text, 'utf8').digest('hex');
}

export function notice(text: string, secret: string): PlatformNotice {
  return { text, sig: sign(text, secret) };
}

export function standingNotices(secret: string): PlatformNotice[] {
  return [notice(STANDING_NOTICE, secret)];
}

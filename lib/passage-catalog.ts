/**
 * Unified content resolver: built-in passages, drills, and user-authored
 * passages all resolve through one id lookup, so the session flow can open
 * any of them. Synchronous by contract — app/session/[passageId].tsx resolves
 * ids at first render.
 */

import { DRILLS, getDrill } from '@/constants/drills';
import { getPassage, PASSAGES } from '@/constants/passages';
import { getGeneratedPassage } from '@/services/practice-generation';
import { getCustomPassage } from '@/services/user-passages';
import type { SessionMode } from '@/types/history';
import type { Passage } from '@/types/session';

export function getAnyPassage(id: string | undefined): Passage | undefined {
  return getPassage(id) ?? getDrill(id) ?? getCustomPassage(id) ?? getGeneratedPassage(id);
}

/** Session-record mode from the content id's namespace. */
export function modeForId(id: string): SessionMode {
  return id.startsWith('drill-') ? 'drill' : 'passage';
}

/** Everything readable in a session (freestyle topics excluded). */
export function allPassages(customs: readonly Passage[]): Passage[] {
  return [...PASSAGES, ...DRILLS, ...customs];
}

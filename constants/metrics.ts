/**
 * The metrics vocabulary — one source of truth for how the app talks about a
 * user's speaking. Every screen that shows a number reads from here, so the
 * same concept can't pick up a different name, unit, or color per screen.
 *
 * Three tiers:
 *   1. One hero metric, the "speaking score", always `NN` + `/100` (never `%`).
 *   2. Exactly five skills, same names and same order everywhere.
 *   3. Effort counters (practice time, sessions, streak).
 *
 * PURE module — no React, no imports from `services/`. Safe under bun.
 */

import type { IconSvgElement } from '@hugeicons/react-native';
import {
  AudioWave01Icon,
  Chatting01Icon,
  DashboardSpeed01Icon,
  MaskTheater01Icon,
  Target01Icon,
} from '@hugeicons-pro/core-stroke-rounded';

import type { SkillKey } from '@/types/history';

/** The five skills, in the order every surface renders them. The record field
 * names are historical; `SKILL_LABELS` holds what users actually read. */
export const SKILL_ORDER: readonly SkillKey[] = [
  'accuracy',
  'fluency',
  'pace',
  'fillers',
  'intonation',
] as const;

/** User-facing skill names. The ONLY names shown anywhere — chips, drill cards,
 * skill rows, coaching copy. Never surface the raw record field names. */
export const SKILL_LABELS: Record<SkillKey, string> = {
  accuracy: 'Articulation',
  fluency: 'Flow',
  pace: 'Pacing',
  fillers: 'Fillers',
  intonation: 'Expression',
};

export const SKILL_ICONS: Record<SkillKey, IconSvgElement> = {
  accuracy: Target01Icon,
  fluency: AudioWave01Icon,
  pace: DashboardSpeed01Icon,
  fillers: Chatting01Icon,
  intonation: MaskTheater01Icon,
};

/**
 * The one band vocabulary for a 0–100 score, widest band first. Bands are wide
 * so a label feels earned rather than incremental, and they're shared by every
 * screen — a score of 81 reads "Strong" on the summary, Home, and Analytics
 * alike.
 */
export const SCORE_BANDS: readonly { min: number; label: string }[] = [
  { min: 90, label: 'Orator' },
  { min: 75, label: 'Strong' },
  { min: 60, label: 'Steady' },
  { min: 0, label: 'Building' },
] as const;

/**
 * The color rule for metric surfaces lives in `constants/colors.ts` now, so
 * metric colors can't drift from the rest of the app. It is still encoded by
 * construction — the palette has no metric red, so no metric can render one:
 *
 *   - Values are always `foreground`. A score is never colored by how good it is.
 *   - `positive` is only for an improving delta; `tertiary` covers flat/declining.
 *   - `focus` is only for the single FOCUS pill on the weakest skill.
 */

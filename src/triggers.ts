// per-turn magnitude evaluation. returns a trigger when a turn is
// "big enough" to warrant a thread. v1 has only the magnitude trigger;
// phase 3 will add a sonnet-driven complexity trigger alongside.

import type { Turn } from "./turns";
import { readStartupSetting } from "./settings";

export const MAGNITUDE_THRESHOLDS = {
  tokens: readStartupSetting("META_MAGNITUDE_TOK", 1500),
  toolCalls: readStartupSetting("META_MAGNITUDE_TC", 5),
  characters: readStartupSetting("META_MAGNITUDE_CHARS", 6000),
} as const;

export type Trigger = {
  kind: "magnitude";
  reason: string;
  tokens?: number;
  toolCalls?: number;
  chars?: number;
};

export function evaluateTurn(turn: Turn): Trigger | null {
  const reasons: string[] = [];

  if (turn.outputTokens > MAGNITUDE_THRESHOLDS.tokens) {
    reasons.push(`${turn.outputTokens} tok`);
  } else if (turn.outputTokens === 0 && turn.outputChars > MAGNITUDE_THRESHOLDS.characters) {
    // fallback when usage tokens aren't reported on this record
    reasons.push(`${turn.outputChars} chars`);
  }

  if (turn.toolUseCount > MAGNITUDE_THRESHOLDS.toolCalls) {
    reasons.push(`${turn.toolUseCount} tools`);
  }

  if (reasons.length === 0) return null;

  const t: Trigger = {
    kind: "magnitude",
    reason: reasons.join(" · "),
  };
  if (turn.outputTokens) t.tokens = turn.outputTokens;
  if (turn.toolUseCount) t.toolCalls = turn.toolUseCount;
  if (turn.outputChars) t.chars = turn.outputChars;
  return t;
}

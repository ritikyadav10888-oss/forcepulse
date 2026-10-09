// Scoring engine types. Same shapes as the web app's src/lib/sports/types.ts and src/types (Sport, ScoreEvent),
// so the web app can import these engines as they are.

export interface Sport {
  id: string;
  name: string;
  icon: string;
  accent: string;
  teamSize: number;
  maxSubstitutes: number;
  roles: string[];
  /** Typical values, offered as suggestions only (FR-SCR-02); never applied unless the organiser picks them. */
  defaultRules: Record<string, number | string>;
  scoringModule: string;
}

export interface ScoreEvent {
  id: string;
  matchId: string;
  seq: number;
  action: string;
  payload: Record<string, number | string | boolean | null>;
  createdAt: string;
}

/** One setting an organiser can choose in a rule set (FR-SCR-01): which knobs exist, never their values. */
export interface RuleKnob {
  key: string;
  label: string;
  type: "number" | "select" | "boolean";
  min?: number;
  max?: number;
  options?: string[];
  required: boolean;
}

export type MatchPhase = "setup" | "live" | "period_break" | "complete";

export type ActionTone =
  | "default"
  | "muted"
  | "boundary"
  | "six"
  | "danger"
  | "success"
  | "outline";

export type ActionShape = "circle" | "tile" | "wide";

export type BallTone = "dot" | "run" | "four" | "six" | "wicket" | "extra";

export interface ActionFieldOption {
  value: string;
  label: string;
}

export interface ActionField {
  key: string;
  label: string;
  type: "player" | "team" | "select" | "players";
  /** Key into MatchState.playerSets */
  from?: string;
  options?: ActionFieldOption[];
  required?: boolean;
}

export interface ScoringAction {
  id: string;
  /** Event action string stored on ScoreEvent */
  action: string;
  label: string;
  group: string;
  payload?: Record<string, string | number | boolean | null>;
  fields?: ActionField[];
  confirm?: string;
  shape?: ActionShape;
  tone?: ActionTone;
  visible?: (state: MatchState) => boolean;
}

export interface SetupStep {
  id: string;
  title: string;
  description?: string;
  action: string;
  fields: ActionField[];
  done: (state: MatchState) => boolean;
}

export interface ScoreLine {
  id: string;
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}

export interface ScoreSummary {
  home: string | number;
  away: string | number;
  headline: string;
  subline?: string;
  status?: string;
  chips?: { id: string; label: string; tone?: "default" | "live" | "warn" | "boundary" }[];
  lines: ScoreLine[];
  groups?: { title: string; lines: ScoreLine[] }[];
  balls?: { label: string; tone?: BallTone }[];
}

export interface PendingPrompt {
  title: string;
  description?: string;
  action: string;
  fields: ActionField[];
}

export interface MatchState {
  phase: MatchPhase;
  scores: { home: number; away: number };
  periodLabel?: string;
  flags: Record<string, boolean | string | number | null>;
  playerSets: Record<string, string[]>;
  pending: PendingPrompt | null;
  meta: Record<string, string | number | boolean | null>;
  /** Sport-private snapshot used by that module's summarise / winner helpers. */
  data: Record<string, unknown>;
}

export interface SportLayout {
  scoreboard: "hero" | "split";
  actions: "circles" | "tiles";
}

export interface SportModule {
  sportId: string;
  sport: Sport;
  /** Rule-set knobs for this sport. Missing on the web app's own modules. */
  ruleKnobs?: RuleKnob[];
  actions: ScoringAction[];
  setupSteps: SetupStep[];
  layout: SportLayout;
  computeState(
    events: ScoreEvent[],
    rules: Record<string, number | string>,
  ): MatchState;
  isMatchOver(state: MatchState, rules: Record<string, number | string>): boolean;
  getWinner(state: MatchState): string | "draw" | null;
  summarise(state: MatchState): ScoreSummary;
  playerStats(events: ScoreEvent[]): Record<string, Record<string, number>>;
  statLabels: Record<string, string>;
  formatEvent(event: ScoreEvent, state: MatchState): string;
}

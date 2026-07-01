export type LegGrade = {
  leg: string;
  confidence: number;
  reasoning: string;
};

export type SportsData = {
  mlb: Record<string, unknown>;
  soccer: Record<string, unknown>;
  wnba: Record<string, unknown>;
};

export type TieredSlip = {
  tier: string;
  legs: string[];
  odds: string;
  overall: number;
};

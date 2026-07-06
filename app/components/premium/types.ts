export type TieredSlip = {
  tier: string;
  legs: string[];
  odds: string;
  overallConfidence: number;
};

export type CouncilModel = {
  model: string;
  grades: Array<{
    leg: string;
    confidence: number;
    reasoning: string;
  }>;
};

export type BotResponse = {
  timestamp: string;
  slips: TieredSlip[];
  warnings: string[];
  councilConsensus: {
    models: CouncilModel[];
    consensus: Array<{
      leg: string;
      avgConfidence: number;
      agreement: string;
    }>;
    averageConfidence: number;
    weeklyRankings?: Array<{
      model: string;
      avgConfidence: number;
      totalSlips: number;
    }>;
  };
  sharpPublic?: {
    sharpLegs: Array<{ name: string; edge: number }>;
    publicLegs: Array<{ name: string }>;
  };
};

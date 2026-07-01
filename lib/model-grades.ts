import type { LegGrade } from '@/lib/types';

const BASE_LEGS: LegGrade[] = [
  { leg: 'Phillies ML', confidence: 73, reasoning: 'Strong home pitching + lineup' },
  { leg: 'Dodgers ML', confidence: 71, reasoning: 'Ace on mound vs weak opponent' },
  { leg: 'Yankees ML', confidence: 70, reasoning: 'Bullpen rested, lineup healthy' },
  { leg: 'Harper Over 1.5 HRR', confidence: 68, reasoning: 'Favorable matchup vs RHP' },
];

const MODEL_BIAS: Record<string, number> = {
  grok: 2,
  claude: 1,
  gpt: 0,
  llama: -1,
  mistral: 0,
  gemini: 1,
  phi: -2,
  qwen: -1,
  gemma: -1,
  falcon: -2,
};

export function gradeLegsForModel(model: string): LegGrade[] {
  const bias = MODEL_BIAS[model] ?? 0;

  return BASE_LEGS.map((leg) => ({
    ...leg,
    confidence: Math.min(95, Math.max(55, leg.confidence + bias)),
    reasoning: `${leg.reasoning} (${model} view)`,
  }));
}

export function defaultGrading(): LegGrade[] {
  return [
    { leg: 'Sample Leg 1', confidence: 72, reasoning: 'Strong matchup variables' },
    { leg: 'Sample Leg 2', confidence: 68, reasoning: 'Good rest + park factor' },
  ];
}

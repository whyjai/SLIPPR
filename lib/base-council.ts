import axios from 'axios';
import type { SportsData, LegGrade } from '@/lib/types';
import { defaultGrading } from '@/lib/model-grades';

export type ModelCouncilResult = {
  model: string;
  weight: number;
  grades: LegGrade[];
};

export type ConsensusLeg = {
  leg: string;
  avgConfidence: number;
  agreement: string;
};

export type CouncilGradeResult = {
  models: ModelCouncilResult[];
  consensus: ConsensusLeg[];
  averageConfidence: number;
};

const FREE_MODELS = [
  { name: 'Grok-Edge', endpoint: '/api/models/grok', weight: 1.2 },
  { name: 'Claude-Safe', endpoint: '/api/models/claude', weight: 1.1 },
  { name: 'GPT-Value', endpoint: '/api/models/gpt', weight: 1.0 },
  { name: 'Llama-Fast', endpoint: '/api/models/llama', weight: 0.9 },
  { name: 'Mistral-Quick', endpoint: '/api/models/mistral', weight: 0.95 },
  { name: 'Gemini-Light', endpoint: '/api/models/gemini', weight: 1.0 },
  { name: 'Phi-3', endpoint: '/api/models/phi', weight: 0.85 },
  { name: 'Qwen-Fast', endpoint: '/api/models/qwen', weight: 0.9 },
  { name: 'Gemma-Edge', endpoint: '/api/models/gemma', weight: 0.88 },
  { name: 'Falcon-Light', endpoint: '/api/models/falcon', weight: 0.82 },
];

function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export class AICouncil {
  async gradeLegs(rawData: SportsData): Promise<CouncilGradeResult> {
    const baseUrl = getApiBaseUrl();

    const results = await Promise.all(
      FREE_MODELS.map(async (model) => {
        try {
          const response = await axios.post(
            `${baseUrl}${model.endpoint}`,
            { data: rawData },
            { timeout: 8000 },
          );
          return {
            model: model.name,
            weight: model.weight,
            grades: response.data.grades || defaultGrading(rawData),
          };
        } catch {
          return {
            model: model.name,
            weight: model.weight,
            grades: defaultGrading(rawData),
          };
        }
      }),
    );

    return {
      models: results,
      consensus: this.calculateConsensus(results),
      averageConfidence: this.getAverageConfidence(results),
    };
  }

  protected calculateConsensus(results: ModelCouncilResult[]): ConsensusLeg[] {
    const allLegs = results.flatMap((r) => r.grades);
    const uniqueLegs = [...new Set(allLegs.map((l) => l.leg))];

    return uniqueLegs.map((leg) => {
      const legGrades = allLegs.filter((l) => l.leg === leg);
      const avg = Math.round(
        legGrades.reduce((sum, g) => sum + g.confidence, 0) / legGrades.length,
      );
      return { leg, avgConfidence: avg, agreement: avg > 68 ? 'Strong' : 'Moderate' };
    });
  }

  protected getAverageConfidence(results: ModelCouncilResult[]): number {
    const all = results.flatMap((r) => r.grades);
    return Math.round(all.reduce((sum, g) => sum + g.confidence, 0) / all.length);
  }
}

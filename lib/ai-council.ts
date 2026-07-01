import { AICouncil, type CouncilGradeResult, type ModelCouncilResult } from './base-council';
import type { LegGrade } from '@/lib/types';
import type { TieredSlip } from '@/lib/types';

export type { CouncilGradeResult, ModelCouncilResult, ConsensusLeg } from './base-council';

export type ModelHistoryEntry = {
  date: Date;
  grades: LegGrade[];
  performance: number;
};

export type ModelRanking = {
  model: string;
  avgConfidence: number;
  totalSlips: number;
};

export type TrackedCouncilResult = CouncilGradeResult & {
  consensusSlips: TieredSlip[];
  weeklyRankings: ModelRanking[];
};

const TIERS = ['Safe', 'Balanced', 'Aggressive', 'Props Heavy', 'Longshot'];

export class TrackedAICouncil extends AICouncil {
  private modelHistory = new Map<string, ModelHistoryEntry[]>();

  async gradeLegs(rawData: Parameters<AICouncil['gradeLegs']>[0]): Promise<TrackedCouncilResult> {
    const results = await super.gradeLegs(rawData);

    results.models.forEach((model) => {
      this.trackModelChoices(model.model, model.grades);
    });

    const consensusSlips = this.enforceConsensus(results.models);

    return {
      ...results,
      consensusSlips,
      weeklyRankings: this.getWeeklyRankings(),
    };
  }

  private trackModelChoices(modelName: string, grades: LegGrade[]) {
    if (!this.modelHistory.has(modelName)) {
      this.modelHistory.set(modelName, []);
    }

    const history = this.modelHistory.get(modelName)!;
    history.push({
      date: new Date(),
      grades,
      performance: this.calculateModelPerformance(grades),
    });

    if (history.length > 30) history.shift();
  }

  private enforceConsensus(models: ModelCouncilResult[]): TieredSlip[] {
    if (models.length === 0) return [];

    const agreedLegs = models[0].grades.filter((leg) =>
      models.every((m) =>
        m.grades.some((g) => g.leg === leg.leg && g.confidence >= 65),
      ),
    );

    return this.generateTieredSlips(agreedLegs.slice(0, 20));
  }

  private generateTieredSlips(agreedLegs: LegGrade[]): TieredSlip[] {
    if (agreedLegs.length === 0) return [];

    return Array.from({ length: 20 }, (_, i) => {
      const tier = TIERS[Math.min(Math.floor(i / 4), TIERS.length - 1)];
      const primary = agreedLegs[i % agreedLegs.length];
      const secondary = agreedLegs[(i + 1) % agreedLegs.length];
      const legs =
        primary.leg !== secondary.leg
          ? [
              `${primary.leg} - ${primary.confidence}/100`,
              `${secondary.leg} - ${secondary.confidence}/100`,
            ]
          : [`${primary.leg} - ${primary.confidence}/100`];

      return {
        tier,
        legs,
        odds: `+${Math.floor(Math.random() * 2000) + 800}`,
        overall: Math.round((primary.confidence + secondary.confidence) / 2),
      };
    });
  }

  private calculateModelPerformance(grades: LegGrade[]): number {
    return grades.reduce((sum, g) => sum + g.confidence, 0) / grades.length;
  }

  private getWeeklyRankings(): ModelRanking[] {
    const rankings = Array.from(this.modelHistory.entries()).map(([name, history]) => ({
      model: name,
      avgConfidence:
        history.length > 0
          ? history.reduce((sum, h) => sum + h.performance, 0) / history.length
          : 0,
      totalSlips: history.length,
    }));

    return rankings.sort((a, b) => b.avgConfidence - a.avgConfidence);
  }
}

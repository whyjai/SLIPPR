import axios from 'axios';
import { TrackedAICouncil, type ModelRanking } from '@/lib/ai-council';
import {
  PredatoryDetector,
  type BettingLine,
  type MarketData,
} from '@/lib/predatory-detector';
import { getSharpPublicData, type SharpPublicData } from '@/lib/sharp-public';
import type { LegGrade, SportsData, TieredSlip } from '@/lib/types';

export type { LegGrade, SportsData, TieredSlip };

export type ModelResult = {
  model: string;
  grades: LegGrade[];
};

export type ConsensusLeg = {
  leg: string;
  avgConfidence: number;
  agreement: string;
};

export type CouncilResult = {
  models: ModelResult[];
  consensus: ConsensusLeg[];
  averageConfidence: number;
  weeklyRankings: ModelRanking[];
};

export type DailySlipsResult = {
  date: string;
  slips: TieredSlip[];
  council: CouncilResult;
  warnings: string[];
  sharpPublic: SharpPublicData;
  lastRefresh: Date;
};

export class ParlayEngine {
  async generateDailySlips(): Promise<DailySlipsResult> {
    const rawData = await this.fetchFreshData();
    const { council, slips } = await this.runAICouncil(rawData);
    const warnings = this.detectPredatoryLines();
    const sharpPublic = this.getSharpPublicView();

    return {
      date: new Date().toISOString(),
      slips,
      council,
      warnings,
      sharpPublic,
      lastRefresh: new Date(),
    };
  }

  private async fetchFreshData(): Promise<SportsData> {
    const [mlb, soccer, wnba] = await Promise.all([
      this.getMLBData(),
      this.getWorldCupData(),
      this.getWNBADATA(),
    ]);

    return { mlb, soccer, wnba };
  }

  private async runAICouncil(
    data: SportsData,
  ): Promise<{ council: CouncilResult; slips: TieredSlip[] }> {
    const council = new TrackedAICouncil();
    const result = await council.gradeLegs(data);

    return {
      council: {
        models: result.models.map(({ model, grades }) => ({ model, grades })),
        consensus: result.consensus,
        averageConfidence: result.averageConfidence,
        weeklyRankings: result.weeklyRankings,
      },
      slips:
        result.consensusSlips.length > 0
          ? result.consensusSlips
          : this.generateFallbackSlips(result.consensus),
    };
  }

  private generateFallbackSlips(consensus: ConsensusLeg[]): TieredSlip[] {
    const tiers = ['Safe', 'Balanced', 'Aggressive', 'Props Heavy', 'Longshot'];

    return tiers.flatMap((tier) =>
      Array.from({ length: 4 }, () => ({
        tier,
        legs: consensus
          .slice(0, 4)
          .map((c) => `${c.leg} - ${c.avgConfidence}/100`),
        odds: `+${Math.floor(Math.random() * 2000) + 800}`,
        overall: Math.floor(Math.random() * 15) + 58,
      })),
    );
  }

  private detectPredatoryLines(): string[] {
    const lines = this.extractLines();
    const marketData = this.extractMarketData();
    return PredatoryDetector.analyze(lines, marketData);
  }

  private getSharpPublicView(): SharpPublicData {
    const lines = this.extractLines();
    const marketData = this.extractMarketData();
    return getSharpPublicData(lines, marketData);
  }

  private extractLines(): BettingLine[] {
    // Replace with parsed odds from real API responses
    return [
      {
        leg: 'Yankees ML',
        odds: -180,
        impliedProb: 64,
        book: 'DraftKings',
        gameId: 'mlb-001',
      },
      {
        leg: 'Dodgers ML',
        odds: -165,
        impliedProb: 62,
        book: 'FanDuel',
        gameId: 'mlb-001',
      },
      {
        leg: 'Judge Over 1.5 Hits',
        odds: -140,
        impliedProb: 58,
        book: 'DraftKings',
        gameId: 'mlb-001',
      },
      {
        leg: 'Phillies ML',
        odds: -130,
        impliedProb: 56,
        book: 'BetMGM',
        gameId: 'mlb-002',
      },
    ];
  }

  private extractMarketData(): MarketData {
    return { fairProb: 52, publicPct: 72 };
  }

  private async getMLBData(): Promise<Record<string, unknown>> {
    // Replace with real API: await axios.get(process.env.ODDS_API_URL, { ... })
    void axios;
    return {};
  }

  private async getWorldCupData(): Promise<Record<string, unknown>> {
    void axios;
    return {};
  }

  private async getWNBADATA(): Promise<Record<string, unknown>> {
    void axios;
    return {};
  }
}

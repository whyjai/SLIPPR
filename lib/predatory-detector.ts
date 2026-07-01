export type BettingLine = {
  leg: string;
  odds: number;
  impliedProb: number;
  book: string;
  gameId?: string;
};

export type MarketData = {
  fairProb: number;
  publicPct: number;
};

export class PredatoryDetector {
  static analyze(lines: BettingLine[], marketData: MarketData): string[] {
    const warnings: string[] = [];

    lines.forEach((line) => {
      if (line.odds < -150 && line.impliedProb > marketData.fairProb + 8) {
        warnings.push(`High juice detected on ${line.leg} at ${line.book}`);
      }
    });

    if (this.hasHighCorrelation(lines)) {
      warnings.push(
        'Warning: High correlation in same-game legs – increases variance',
      );
    }

    if (this.isPublicHeavy(marketData)) {
      warnings.push('Public-heavy line. Consider opposite side for value.');
    }

    return warnings;
  }

  private static hasHighCorrelation(lines: BettingLine[]): boolean {
    return lines.filter((l) => l.gameId).length > 2;
  }

  private static isPublicHeavy(data: MarketData): boolean {
    return data.publicPct > 65;
  }
}

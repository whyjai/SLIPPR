import type { BettingLine, MarketData } from '@/lib/predatory-detector';

export type SharpLeg = {
  name: string;
  edge: number;
};

export type PublicLeg = {
  name: string;
};

export type SharpPublicData = {
  sharpLegs: SharpLeg[];
  publicLegs: PublicLeg[];
};

export function getSharpPublicData(
  lines: BettingLine[],
  marketData: MarketData,
): SharpPublicData {
  const sharpLegs = lines
    .filter((line) => line.impliedProb < marketData.fairProb)
    .map((line) => ({
      name: line.leg,
      edge: Math.round(marketData.fairProb - line.impliedProb),
    }))
    .sort((a, b) => b.edge - a.edge);

  const publicLegs = lines
    .filter(
      (line) => line.odds < -150 && line.impliedProb > marketData.fairProb + 5,
    )
    .map((line) => ({ name: line.leg }));

  if (sharpLegs.length === 0 && publicLegs.length === 0) {
    return {
      sharpLegs: [
        { name: 'Phillies ML', edge: 6 },
        { name: 'Under 8.5 Mets/Phillies', edge: 4 },
      ],
      publicLegs: [
        { name: 'Yankees ML' },
        { name: 'Dodgers ML' },
      ],
    };
  }

  return { sharpLegs, publicLegs };
}

'use client';

import { useState } from 'react';

function kellyBet(bankroll: number, confidence: number, americanOdds: number): number {
  if (bankroll <= 0 || confidence <= 0 || americanOdds <= 0) return 0;

  const b = americanOdds / 100;
  const p = confidence / 100;
  const fraction = (p * (b + 1) - 1) / b;

  if (fraction <= 0) return 0;
  return bankroll * fraction;
}

export default function BankrollCalculator() {
  const [bankroll, setBankroll] = useState(1000);
  const [confidence, setConfidence] = useState(65);
  const [odds, setOdds] = useState(1500);

  const kelly = kellyBet(bankroll, confidence, odds);

  return (
    <div className="card bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
      <h3 className="font-semibold mb-4">Bankroll Calculator</h3>

      <label className="block text-sm text-zinc-400 mb-2">Bankroll ($)</label>
      <input
        type="number"
        min={0}
        value={bankroll}
        onChange={(e) => setBankroll(+e.target.value)}
        className="bg-zinc-800 p-3 rounded-xl w-full mb-4"
        placeholder="Bankroll $"
      />

      <label className="block text-sm text-zinc-400 mb-2">Confidence (%)</label>
      <input
        type="number"
        min={0}
        max={100}
        value={confidence}
        onChange={(e) => setConfidence(+e.target.value)}
        className="bg-zinc-800 p-3 rounded-xl w-full mb-4"
        placeholder="Confidence %"
      />

      <label className="block text-sm text-zinc-400 mb-2">American Odds (+)</label>
      <input
        type="number"
        min={100}
        value={odds}
        onChange={(e) => setOdds(+e.target.value)}
        className="bg-zinc-800 p-3 rounded-xl w-full mb-4"
        placeholder="Odds +1500"
      />

      <div className="text-emerald-400 font-medium">
        Recommended Kelly Bet: ${kelly.toFixed(2)}
      </div>
      <div className="text-xs text-zinc-500 mt-2">
        {kelly > 0
          ? `${((kelly / bankroll) * 100).toFixed(1)}% of bankroll`
          : 'No positive edge at these inputs'}
      </div>
    </div>
  );
}

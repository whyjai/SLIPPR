'use client';

import type { ReactNode } from 'react';
import { Badge, PageHeader } from './ui';
import PropSheetPanel from './PropSheetPanel';

export default function NhlResearchView({ sportSwitch }: { sportSwitch: ReactNode }) {
  return (
    <div className="px-6 pb-16 pt-10 lg:px-10">
      <div className="mx-auto max-w-6xl">
        <PageHeader
          eyebrow="Research"
          title="NHL Prop Research"
          description="Shots on goal, points, goals, assists and goalie saves for the next slate, calibrated on five seasons of game logs. No odds, no picks."
          actions={<div className="flex flex-wrap items-center gap-2">{sportSwitch}</div>}
        />
        <div className="animate-fade-up mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
          <Badge tone="zinc">NHL stats API</Badge>
          <span>Regular season game logs, 2021-22 to today · rosters from the NHL, injuries from ESPN</span>
        </div>
        <PropSheetPanel league="nhl" />
      </div>
    </div>
  );
}

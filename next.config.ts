import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The prop-sheet track record is read from the repo at request time.
  outputFileTracingIncludes: {
    "/api/research/nfl/props/track": ["./data/research/prop-sheets/*-track.json"],
    "/api/research/[league]/props/track": ["./data/research/prop-sheets/*-track.json"],
    "/api/research/nhl/props/track": ["./data/research/prop-sheets/nhl-track.json"],
  },
};

export default nextConfig;

"use client";

import { useCallback, useEffect, useState } from "react";

import RetryButton from "@/components/RetryButton";
import {
  fetchLeaderboard,
  type LeaderboardRow,
} from "@/lib/table-chips-client";

/**
 * HIGH ROLLERS — the play-chip leaderboard for The Table.
 *
 * Self-contained: mount it anywhere inside the dashboard and it fetches
 * /api/table/leaderboard itself. Shows the top bankrolls, with the caller's own
 * row pinned at the bottom when they're outside the top ten.
 *
 * Play chips only — cosmetic bragging rights, never money.
 *
 * NOT mounted anywhere yet; placement is the orchestrator's call.
 */

const GOLD = "#e3c071";
const GOLD_HI = "#f7e8ac";
const CRIMSON = "#b21d3b";

/** 1/2/3 get a warmer gold; everyone else reads in muted cream. */
function rankColor(rank: number): string {
  if (rank === 1) return GOLD_HI;
  if (rank === 2 || rank === 3) return GOLD;
  return "rgba(245,240,240,0.72)";
}

function formatChips(value: number): string {
  return value.toLocaleString("en-US");
}

export default function ChipLeaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [viewer, setViewer] = useState<LeaderboardRow | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    fetchLeaderboard()
      .then((data) => {
        setRows(data.entries);
        setViewer(data.viewer);
      })
      .catch(() => {
        setRows(null);
        setError(true);
      });
  }, []);

  useEffect(() => load(), [load]);

  return (
    <section style={panelStyle} aria-label="Chip leaderboard">
      {/* Faint card-suit motif, matching the table page's corner accents. */}
      <div aria-hidden style={accentStyle}>
        ♠
      </div>

      <header style={{ marginBottom: 18 }}>
        <p style={eyebrowStyle}>High Rollers</p>
        <p style={subStyle}>House chips only — bragging rights, nothing more.</p>
      </header>

      {error ? (
        <div className="state-message state-message-error">
          <p>Couldn&apos;t load the leaderboard.</p>
          <RetryButton onRetry={load} />
        </div>
      ) : rows === null ? (
        <div className="state-message">
          <p>Counting the rail…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="state-message">
          <p>No one has taken a seat yet.</p>
        </div>
      ) : (
        <div role="table" aria-label="Top chip balances">
          <div role="row" style={headRowStyle}>
            <span role="columnheader" style={headCellStyle}>
              #
            </span>
            <span role="columnheader" style={headCellStyle}>
              Player
            </span>
            <span role="columnheader" style={{ ...headCellStyle, textAlign: "right" }}>
              Won
            </span>
            <span role="columnheader" style={{ ...headCellStyle, textAlign: "right" }}>
              Chips
            </span>
          </div>

          {rows.map((row) => (
            <Row key={`rank-${row.rank}-${row.displayName}`} row={row} />
          ))}

          {viewer && (
            <>
              <div aria-hidden style={dividerStyle} />
              <Row row={viewer} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ row }: { row: LeaderboardRow }) {
  const color = rankColor(row.rank);
  return (
    <div
      role="row"
      style={{
        ...rowStyle,
        ...(row.isViewer ? viewerRowStyle : null),
        ...(row.rank <= 3 ? topRowStyle : null),
      }}
    >
      <span role="cell" style={{ ...cellStyle, color, fontVariantNumeric: "tabular-nums" }}>
        {row.rank}
      </span>
      <span
        role="cell"
        style={{
          ...cellStyle,
          color,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {row.displayName}
        {row.isViewer && <span style={youTagStyle}>you</span>}
      </span>
      <span role="cell" style={{ ...numberCellStyle, color: "rgba(245,240,240,0.45)" }}>
        {formatChips(row.handsWon)}
      </span>
      <span role="cell" style={{ ...numberCellStyle, color }}>
        {formatChips(row.balance)}
      </span>
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────
// Inline, in the High-Roller Noir palette the table page already uses:
// gold on warm near-black, crimson only as the viewer's marker, Georgia serif.

const panelStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  padding: "26px 24px 22px",
  border: "1px solid rgba(231,192,113,0.14)",
  background: "linear-gradient(180deg, rgba(18,14,12,0.92), rgba(8,6,6,0.94))",
  fontFamily: "Georgia, serif",
};

const accentStyle: React.CSSProperties = {
  position: "absolute",
  top: -10,
  right: 10,
  fontSize: 56,
  lineHeight: 1,
  color: "rgba(231,192,113,0.06)",
  userSelect: "none",
  pointerEvents: "none",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: 4,
  textTransform: "uppercase",
  color: GOLD,
  marginBottom: 8,
};

const subStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 0.5,
  color: "rgba(245,240,240,0.42)",
};

const headRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "28px 1fr 62px 92px",
  gap: 10,
  padding: "0 4px 8px",
  borderBottom: "1px solid rgba(231,192,113,0.12)",
};

const headCellStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: 2,
  textTransform: "uppercase",
  color: "rgba(231,192,113,0.5)",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "28px 1fr 62px 92px",
  gap: 10,
  alignItems: "center",
  padding: "10px 4px",
  borderBottom: "1px solid rgba(231,192,113,0.06)",
};

const topRowStyle: React.CSSProperties = {
  background: "rgba(231,192,113,0.035)",
};

const viewerRowStyle: React.CSSProperties = {
  borderLeft: `2px solid ${CRIMSON}`,
  paddingLeft: 8,
  background: "rgba(178,29,59,0.06)",
};

const cellStyle: React.CSSProperties = {
  fontSize: 13,
  letterSpacing: 0.4,
};

const numberCellStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};

const youTagStyle: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 8,
  letterSpacing: 2,
  textTransform: "uppercase",
  color: CRIMSON,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: "6px 0",
  background:
    "linear-gradient(90deg, transparent, rgba(231,192,113,0.28), transparent)",
};

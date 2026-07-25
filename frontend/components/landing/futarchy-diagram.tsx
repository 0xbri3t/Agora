const YES_SPARK = "M0,20 L14,16 L28,19 L42,10 L56,13 L70,4 L84,7 L98,2"
const NO_SPARK = "M0,6 L14,10 L28,7 L42,15 L56,12 L70,19 L84,16 L98,22"

function NodeBox({
  x,
  y,
  w,
  h,
  label,
  stroke = "var(--foreground)",
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  stroke?: string
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
      />
      <text
        x={x + w / 2}
        y={y + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground font-sans"
        fontSize={13}
      >
        {label}
      </text>
    </g>
  )
}

function MarketNode({
  x,
  y,
  w,
  h,
  label,
  rail,
  sparkPath,
}: {
  x: number
  y: number
  w: number
  h: number
  label: string
  rail: string
  sparkPath: string
}) {
  const sparkX = x + 14
  const sparkY = y + h - 22
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill="none"
        stroke={rail}
        strokeWidth={1.5}
      />
      <text
        x={x + w / 2}
        y={y + 24}
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground font-sans"
        fontSize={13}
      >
        {label}
      </text>
      <g transform={`translate(${sparkX}, ${sparkY})`}>
        <path
          d={sparkPath}
          fill="none"
          stroke={rail}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.85}
        />
      </g>
    </g>
  )
}

export function FutarchyDiagram() {
  // Layout constants (viewBox units).
  const nodeW = 118
  const nodeH = 64
  const marketW = 132
  const marketH = 66

  const proposalX = 10
  const proposalY = 96
  const yesX = 200
  const yesY = 24
  const noX = 200
  const noY = 168
  const twapX = 410
  const twapY = 96
  const execX = 570
  const execY = 96

  const proposalCx = proposalX + nodeW
  const proposalCy = proposalY + nodeH / 2
  const yesCy = yesY + marketH / 2
  const noCy = noY + marketH / 2
  const twapCx = twapX
  const twapCy = twapY + nodeH / 2

  return (
    <div className="w-full">
      <svg
        viewBox="0 0 700 250"
        width="100%"
        role="img"
        aria-label="Diagram: a proposal splits into a YES market and a NO market, both feed a TWAP comparison, which triggers execution."
        className="h-auto w-full"
      >
        {/* Connectors: proposal -> yes/no rails */}
        <path
          d={`M ${proposalCx} ${proposalCy} C ${proposalCx + 60} ${proposalCy}, ${yesX - 60} ${yesCy}, ${yesX} ${yesCy}`}
          fill="none"
          stroke="var(--data-up)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <path
          d={`M ${proposalCx} ${proposalCy} C ${proposalCx + 60} ${proposalCy}, ${noX - 60} ${noCy}, ${noX} ${noCy}`}
          fill="none"
          stroke="var(--data-down)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />

        {/* Connectors: rails -> TWAP compare */}
        <path
          d={`M ${yesX + marketW} ${yesCy} C ${yesX + marketW + 60} ${yesCy}, ${twapX - 60} ${twapCy}, ${twapX} ${twapCy}`}
          fill="none"
          stroke="var(--data-up)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <path
          d={`M ${noX + marketW} ${noCy} C ${noX + marketW + 60} ${noCy}, ${twapX - 60} ${twapCy}, ${twapX} ${twapCy}`}
          fill="none"
          stroke="var(--data-down)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />

        {/* Connector: TWAP -> Execute */}
        <path
          d={`M ${twapX + nodeW} ${twapCy} L ${execX} ${execY + nodeH / 2}`}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />

        <NodeBox x={proposalX} y={proposalY} w={nodeW} h={nodeH} label="Proposal" />
        <MarketNode
          x={yesX}
          y={yesY}
          w={marketW}
          h={marketH}
          label="YES market"
          rail="var(--data-up)"
          sparkPath={YES_SPARK}
        />
        <MarketNode
          x={noX}
          y={noY}
          w={marketW}
          h={marketH}
          label="NO market"
          rail="var(--data-down)"
          sparkPath={NO_SPARK}
        />
        <NodeBox x={twapX} y={twapY} w={nodeW} h={nodeH} label="TWAP compare" />
        <NodeBox x={execX} y={execY} w={nodeW} h={nodeH} label="Execute" />
      </svg>
    </div>
  )
}

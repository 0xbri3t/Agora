import Link from "next/link"
import { Button } from "@/components/ui/button"
import { LiveMarketsPanel } from "@/components/landing/live-markets-panel"
import { TickerTape } from "@/components/landing/ticker-tape"
import { FutarchyDiagram } from "@/components/landing/futarchy-diagram"
import { TeeSpec } from "@/components/landing/tee-spec"
import { PixelAgora } from "@/components/landing/pixel-agora"

const BUILT_ON = ["1inch Aqua", "Ethereum Sepolia", "Pyth", "USDC"]

export default function HomePage() {
  return (
    <div className="relative">
      <section className="flex min-h-[calc(100vh-4rem-1.5rem)] flex-col justify-between pb-6">
        <div className="container mx-auto grid flex-1 grid-cols-1 gap-8 px-6 py-10 md:py-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-2">
          <div className="flex flex-col justify-center gap-6">
            <h1 className="max-w-xl font-display text-[clamp(3rem,8vw,7rem)] leading-[0.95] text-foreground">
              Markets decide.
            </h1>
            <p className="max-w-md text-lg text-muted-foreground">
              Proposals become prediction markets. Price picks the outcome.
              Contracts execute it.
            </p>
            <Button asChild variant="ghost" className="w-fit px-0">
              <Link href="/proposals">Explore markets &#8599;</Link>
            </Button>
          </div>

          <div className="hidden lg:block">
            <PixelAgora className="flex h-full min-h-[520px] w-full items-center justify-center" />
          </div>
        </div>

        <TickerTape />
      </section>

      <section className="border-t border-border">
        <div className="container mx-auto grid grid-cols-1 gap-10 px-6 py-16 md:py-24 lg:grid-cols-[1fr_minmax(0,420px)] lg:items-center lg:gap-16">
          <div className="flex flex-col gap-4">
            <p className="font-display text-2xl leading-snug text-foreground md:text-[1.75rem]">
              Live conditional markets, on chain right now.
            </p>
            <p className="max-w-md text-muted-foreground">
              Every proposal opens a YES and a NO market. These are trading as
              you read this.
            </p>
          </div>
          <LiveMarketsPanel className="w-full max-w-md justify-self-center lg:justify-self-end" />
        </div>
      </section>

      <section className="border-t border-border">
        <div className="container mx-auto grid grid-cols-1 gap-10 px-6 py-16 md:py-24 lg:grid-cols-[1fr_minmax(0,420px)] lg:items-center lg:gap-16">
          <FutarchyDiagram />
          <div className="flex flex-col gap-4">
            <p className="font-display text-2xl leading-snug text-foreground md:text-[1.75rem]">
              Two conditional markets trade the same decision.
              <br />
              The stronger TWAP wins.
              <br />
              The contract executes the winner.
            </p>
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="container mx-auto max-w-2xl px-6 py-16 md:py-24">
          <TeeSpec />
        </div>
      </section>

      <section className="border-t border-border">
        <div className="container mx-auto flex flex-col items-center gap-6 px-6 py-14 md:flex-row md:justify-between">
          <span className="text-sm text-muted-foreground">Built on</span>
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
            {BUILT_ON.map((name) => (
              <li
                key={name}
                className="font-display text-base text-foreground opacity-60"
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TypewriterEffectSmooth } from "@/components/ui/typewriter-effect"
import { FlipWords } from "@/components/ui/flip-words";


import {
  ArrowRight,
  TrendingUp,
  Vote,
  Zap,
  Shield,
  Users,
  BarChart3,
  Coins,
  CheckCircle2,
  Sparkles,
  Target,
  Lock,
  Rocket,
  Cpu,
  ShieldCheck,
  EyeOff,
  Fingerprint,
  Send
} from "lucide-react"


function HeroFlipWords() {
  const words: string[] = ["everyone", "DAO's", "Equity", "DeFi", "governance", "Insurance", "open source", "L2s"];

  return (
    <div className="w-full flex flex-col items-center justify-center px-4">
      <div className="relative inline-block text-center w-full text-5xl sm:text-6xl xl:text-8xl font-normal text-neutral-600 dark:text-neutral-400 leading-tight">
        <span className="whitespace-nowrap block">Futarchy for</span>
        <span className="block mt-2">
          <FlipWords words={words} />
        </span>
      </div>
    </div>
  );
}

export default function HomePage() {

  return (
    <div className="relative">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="container relative mx-auto px-4 py-20 md:py-32">
          <div className="flex flex-col items-center  justify-center text-center space-y-8 max-w-6xl mx-auto">

            <div className="flex justify-center w-full">
              <HeroFlipWords />
            </div>

            <p className="text-xl mt-16 mb-10 md:text-2xl text-muted-foreground  leading-relaxed w-full  md:max-w-6xl">
              FutarFi combines prediction markets with decentralized governance. Create proposals, open prediction markets, and execute outcomes trustlessly. Let markets decide the future of your organization through decentralized governance
            </p>

            <div className="flex flex-col sm:flex-row gap-4 pt-6">
              <Button asChild size="lg" className="text-lg px-8 h-12 group">
                <Link href="/proposals/new">
                  Create Proposal
                  <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="text-lg px-8 h-12 bg-transparent">
                <Link href="/proposals">Explore Markets</Link>
              </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8 pt-12 w-full max-w-2xl">
              <div className="space-y-1">
                <div className="text-3xl md:text-4xl font-bold">$2.4M</div>
                <div className="text-sm text-muted-foreground">Total Volume</div>
              </div>
              <div className="space-y-1">
                <div className="text-3xl md:text-4xl font-bold">156</div>
                <div className="text-sm text-muted-foreground">Active Markets</div>
              </div>
              <div className="space-y-1">
                <div className="text-3xl md:text-4xl font-bold">3.2K</div>
                <div className="text-sm text-muted-foreground">Participants</div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* Features Grid */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl md:text-5xl font-bold">Why Futarchy?</h2>
          <p className="text-xl text-muted-foreground w-full mx-auto">
            Market-driven governance that aligns incentives and reveals true preferences
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="p-8 space-y-4 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
            <div className="p-3 rounded-xl bg-primary/10 w-fit">
              <TrendingUp className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-2xl font-semibold">Prediction Markets</h3>
            <p className="text-muted-foreground leading-relaxed">
              Harness the wisdom of crowds through liquid prediction markets that reveal expected outcomes before
              execution.
            </p>
          </Card>

          <Card className="p-8 space-y-4 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
            <div className="p-3 rounded-xl bg-primary/10 w-fit">
              <Vote className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-2xl font-semibold">Voting through Price Discovery</h3>
            <p className="text-muted-foreground leading-relaxed">
              Democratic governance where token holders have influence over organizational decisions.
            </p>
          </Card>

          <Card className="p-8 space-y-4 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
            <div className="p-3 rounded-xl bg-primary/10 w-fit">
              <Zap className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-2xl font-semibold">Automated Execution</h3>
            <p className="text-muted-foreground leading-relaxed">
              Smart contracts automatically execute approved proposals without intermediaries or manual intervention.
            </p>
          </Card>

          <Card className="p-8 space-y-4 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
            <div className="p-3 rounded-xl bg-primary/10 w-fit">
              <Shield className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-2xl font-semibold">Trustless & Secure</h3>
            <p className="text-muted-foreground leading-relaxed">
              Built on blockchain technology ensuring transparency, immutability, and censorship resistance.
            </p>
          </Card>

          <Card className="p-8 space-y-4 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
            <div className="p-3 rounded-xl bg-primary/10 w-fit">
              <BarChart3 className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-2xl font-semibold">Real-Time Analytics</h3>
            <p className="text-muted-foreground leading-relaxed">
              Align token holders with real positive value proposals. Track market sentiment, price movements, and voting patterns with comprehensive analytics dashboards.
            </p>
          </Card>

          <Card className="p-8 space-y-4 hover:border-primary/50 transition-all hover:shadow-lg hover:shadow-primary/5">
            <div className="p-3 rounded-xl bg-primary/10 w-fit">
              <Coins className="h-7 w-7 text-primary" />
            </div>
            <h3 className="text-2xl font-semibold">Multi-Token Support</h3>
            <p className="text-muted-foreground leading-relaxed">
              Support for multiple subject tokens including ETH, BTC, PYTH, HBAR, and more.
            </p>
          </Card>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center space-y-4 mb-16">
          <h2 className="text-3xl md:text-5xl font-bold">How It Works</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Simple, transparent process from proposal to execution
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-8 max-w-6xl mx-auto">
          <div className="relative">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="relative p-6 rounded-2xl bg-background border-2 border-primary">
                  <Target className="h-10 w-10 text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-primary">STEP 1</div>
                <h3 className="text-xl font-bold">Create Proposal</h3>
                <p className="text-sm text-muted-foreground">
                  Submit your proposal with details, target contract, and parameters
                </p>
              </div>
            </div>
            <div className="hidden md:block absolute top-16 left-full w-full h-0.5 bg-gradient-to-r from-primary/50 to-transparent" />
          </div>

          <div className="relative">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="relative p-6 rounded-2xl bg-background border-2 border-primary">
                  <TrendingUp className="h-10 w-10 text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-primary">STEP 2</div>
                <h3 className="text-xl font-bold">Dutch Auction</h3>
                <p className="text-sm text-muted-foreground">
                  Participants bid on YES/NO tokens during the price discovery phase
                </p>
              </div>
            </div>
            <div className="hidden md:block absolute top-16 left-full w-full h-0.5 bg-gradient-to-r from-primary/50 to-transparent" />
          </div>

          <div className="relative">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="relative p-6 rounded-2xl bg-background border-2 border-primary">
                  <BarChart3 className="h-10 w-10 text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-primary">STEP 3</div>
                <h3 className="text-xl font-bold">Market Trading</h3>
                <p className="text-sm text-muted-foreground">Trade on live order books with market and limit orders</p>
              </div>
            </div>
            <div className="hidden md:block absolute top-16 left-full w-full h-0.5 bg-gradient-to-r from-primary/50 to-transparent" />
          </div>

          <div className="relative">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative">
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                <div className="relative p-6 rounded-2xl bg-background border-2 border-primary">
                  <Rocket className="h-10 w-10 text-primary" />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold text-primary">STEP 4</div>
                <h3 className="text-xl font-bold">Auto Execute</h3>
                <p className="text-sm text-muted-foreground">Winning outcome triggers automatic on-chain execution</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="text-center space-y-4 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5">
              <Shield className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Powered by TEE Technology</span>
            </div>
            <h2 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
              Hardware-Level Security
            </h2>
            <p className="text-lg text-muted-foreground w-full break-words">
              Our orderbook runs in a Trusted Execution Environment, combining CEX speed with DEX security
            </p>
          </div>

          {/* Bento Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-12">
            {/* Large Feature Card - Spans 2 columns */}
            <Card className="md:col-span-2 lg:col-span-2 p-8 relative overflow-hidden group hover:border-primary/50 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative space-y-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/30">
                    <Lock className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold">Token Verification</h3>
                    <p className="text-sm text-muted-foreground">Ensures encrypted data</p>
                  </div>
                </div>
                <p className="text-muted-foreground leading-relaxed">
                   All users must confirm their transaction with their wallet before sending it to the secure enclave (TEE), ensuring consent and security for every operation.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="rounded-full">
                    <EyeOff className="h-3 w-3 mr-1" />
                    Private
                  </Badge>
      
                </div>
              </div>
            </Card>

            {/* Attestation Card */}
            <Card className="md:col-span-2 p-6 relative overflow-hidden group hover:border-secondary/50 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-secondary/10 via-transparent to-accent/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-gradient-to-br from-secondary/20 to-accent/20 border border-secondary/30">
                    <ShieldCheck className="h-7 w-7 text-secondary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">Hardware Attestation</h3>
                    <p className="text-sm text-muted-foreground">Cryptographic proof of integrity</p>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  The TEE hardware signs an attestation proving the exact binary running inside. Anyone can verify the
                  matching engine hasn't been tampered with.
                </p>
                <div className="flex items-center gap-2 text-sm">
                  <Fingerprint className="h-4 w-4 text-secondary" />
                  <span className="font-mono text-xs text-muted-foreground">SHA256: a3f5...c2d9</span>
                </div>
                <Badge variant="secondary" className="rounded-full">
                    <Shield className="h-3 w-3 mr-1" />
                    MEV-Protected
                  </Badge>
              </div>
            </Card>


            <Card className="md:col-span-3 lg:col-span-4 p-8 bg-gradient-to-r from-card via-primary/5 to-card border-2 border-primary/20">
              <div className="space-y-6">
                <div className="text-center">
                  <h3 className="text-2xl font-bold">TEE Orderbook Flow</h3>
                  <p className="text-sm text-muted-foreground mt-1">From order submission to on-chain settlement</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { icon: Send, title: "Submit Order", desc: "User places buy/sell", step: "01" },
                    { icon: ShieldCheck, title: "Verify wallet", desc: "Verify integrity of the user's wallet", step: "02" },
                    { icon: Users, title: "TEE Processing", desc: "Confidential batching orders", step: "03" },
                    { icon: Rocket, title: "Settlement", desc: "On-chain execution", step: "04" },
                  ].map((item, i) => (
                    <div key={i} className="relative">
                      <div className="flex flex-col items-center text-center space-y-3 p-4 rounded-xl bg-background/50 border border-border/50 hover:border-primary/50 transition-colors">
                        <div className="relative">
                          <div className="p-3 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20">
                            <item.icon className="h-6 w-6 text-primary" />
                          </div>
                          <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                            {item.step}
                          </div>
                        </div>
                        <div>
                          <div className="font-semibold">{item.title}</div>
                          <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                        </div>
                      </div>
                      {i < 3 && (
                        <div className="hidden lg:block absolute top-1/2 -right-2 w-4 h-0.5 bg-gradient-to-r from-primary/50 to-transparent" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="container mx-auto px-4 py-20">
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
          <div className="space-y-8">
            <div className="space-y-4">
              <h2 className="text-3xl md:text-5xl font-bold">Better Decisions Through Market Intelligence</h2>
              <p className="text-xl text-muted-foreground leading-relaxed">
                Traditional voting can be swayed by politics and emotions. Futarchy adds a layer of economic reality by
                requiring participants to back their beliefs with capital.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex gap-4">
                <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-1">Skin in the Game</h3>
                  <p className="text-muted-foreground">
                    Market participants risk capital, ensuring informed and thoughtful decision-making
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-1">Price Discovery</h3>
                  <p className="text-muted-foreground">
                    Markets aggregate information efficiently, revealing collective expectations
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-1">Aligned Incentives</h3>
                  <p className="text-muted-foreground">
                    Profit motive aligns with organizational success, reducing conflicts of interest
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0 mt-1" />
                <div>
                  <h3 className="text-lg font-semibold mb-1">Transparent & Auditable</h3>
                  <p className="text-muted-foreground">
                    All transactions and votes recorded immutably on the blockchain
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-secondary/20 to-accent/20 blur-3xl" />
            <Card className="relative p-8 space-y-6 border-2">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-primary/10 w-fit">
                    <Lock className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-2xl font-bold">100%</div>
                  <div className="text-sm text-muted-foreground">Trustless</div>
                </div>
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-primary/10 w-fit">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-2xl font-bold">24/7</div>
                  <div className="text-sm text-muted-foreground">Global Access</div>
                </div>
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-primary/10 w-fit">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-2xl font-bold">3.2K+</div>
                  <div className="text-sm text-muted-foreground">Active Users</div>
                </div>
                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-primary/10 w-fit">
                    <Zap className="h-6 w-6 text-primary" />
                  </div>
                  <div className="text-2xl font-bold">&lt;5s</div>
                  <div className="text-sm text-muted-foreground">Avg Settlement</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

    </div>
  )
}

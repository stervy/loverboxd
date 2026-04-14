"use client";

import { motion } from "framer-motion";
import Link from "next/link";

const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" as const } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.15 } },
};

export default function SermorelinPage() {
  return (
    <main>
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-card-border/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="text-xl font-semibold tracking-[0.2em] uppercase">
            Peppy
          </Link>
          <div className="hidden md:flex items-center gap-10 text-sm tracking-wide">
            <Link href="/#products" className="text-muted hover:text-foreground transition-colors">
              Products
            </Link>
            <Link href="/#science" className="text-muted hover:text-foreground transition-colors">
              Science
            </Link>
            <Link href="/#results" className="text-muted hover:text-foreground transition-colors">
              Results
            </Link>
          </div>
          <Link
            href="/#products"
            className="bg-foreground text-background px-5 py-2 text-sm font-medium tracking-wide hover:bg-warm-white transition-colors"
          >
            Shop Now
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-accent/5 blur-3xl" />
        <motion.div
          className="relative z-10 max-w-6xl mx-auto"
          initial="hidden"
          animate="visible"
          variants={stagger}
        >
          <motion.div variants={fadeUp}>
            <Link href="/" className="text-muted text-sm hover:text-foreground transition-colors">
              &larr; Back to Home
            </Link>
          </motion.div>
          <div className="grid md:grid-cols-2 gap-16 mt-8 items-center">
            <div>
              <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
                Growth. Recovery. Renewal.
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-5xl md:text-6xl font-light tracking-tight leading-tight">
                Sermorelin
              </motion.h1>
              <motion.p variants={fadeUp} className="text-muted text-lg mt-6 leading-relaxed">
                A growth hormone-releasing hormone (GHRH) analog that stimulates your pituitary gland
                to naturally produce and release growth hormone. The key to deeper recovery, better sleep,
                and the body composition you&apos;ve been working toward.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-8 flex items-end gap-3">
                <span className="text-4xl font-light">$249</span>
                <span className="text-muted text-lg mb-1">/month</span>
              </motion.div>
              <motion.div variants={fadeUp} className="mt-8 flex gap-4">
                <button className="bg-accent text-background px-10 py-4 text-sm font-medium tracking-widest uppercase hover:bg-accent-light transition-colors">
                  Start Protocol
                </button>
                <Link
                  href="/products/nad"
                  className="border border-card-border px-8 py-4 text-sm font-medium tracking-wide hover:border-muted transition-colors"
                >
                  View NAD+
                </Link>
              </motion.div>
            </div>

            {/* Product visual */}
            <motion.div
              variants={fadeUp}
              className="relative aspect-square bg-gradient-to-br from-card to-background border border-accent/30 flex items-center justify-center"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent" />
              <div className="relative text-center">
                <div className="w-32 h-32 mx-auto rounded-full border border-accent/30 flex items-center justify-center bg-accent/5">
                  <span className="text-3xl font-extralight text-accent">Sm</span>
                </div>
                <p className="text-muted text-xs tracking-widest uppercase mt-6">Pharmaceutical Grade</p>
                <p className="text-accent text-xs tracking-widest uppercase mt-1">Most Popular</p>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* Benefits grid */}
      <section className="py-24 px-6 bg-card">
        <div className="max-w-6xl mx-auto">
          <motion.div
            className="text-center mb-16"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
              Why Sermorelin
            </motion.p>
            <motion.h2 variants={fadeUp} className="text-4xl font-light tracking-tight">
              Unlock your body&apos;s natural potential
            </motion.h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-card-border">
            {[
              {
                title: "Growth Hormone Release",
                desc: "Stimulates your pituitary gland to produce GH naturally — mimicking your body's own signaling rather than introducing synthetic hormones.",
              },
              {
                title: "Deep, Restorative Sleep",
                desc: "GH is primarily released during deep sleep. Sermorelin enhances sleep architecture, leading to more time in restorative sleep stages.",
              },
              {
                title: "Accelerated Recovery",
                desc: "Faster muscle repair between training sessions. Reduced soreness and inflammation so you can train harder, more consistently.",
              },
              {
                title: "Lean Body Composition",
                desc: "Supports fat metabolism while preserving lean muscle mass. The body recomposition effect athletes and fitness enthusiasts seek.",
              },
              {
                title: "Skin & Joint Health",
                desc: "Promotes collagen synthesis for healthier skin, stronger connective tissue, and more resilient joints under training stress.",
              },
              {
                title: "Immune Support",
                desc: "Optimal GH levels support immune function, helping your body defend against illness and recover from physical stress.",
              },
            ].map((item) => (
              <motion.div
                key={item.title}
                className="bg-card p-8 md:p-10"
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                variants={fadeUp}
              >
                <h3 className="text-lg font-medium">{item.title}</h3>
                <p className="text-muted text-sm mt-3 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Protocol timeline */}
      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
          >
            <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
              Your Protocol
            </motion.p>
            <motion.h2 variants={fadeUp} className="text-4xl font-light tracking-tight mb-12">
              What to expect
            </motion.h2>

            <div className="space-y-8">
              {[
                {
                  week: "Weeks 1-2",
                  title: "Initiation Phase",
                  desc: "Your pituitary gland begins responding to sermorelin. Most members notice improved sleep quality within the first week.",
                },
                {
                  week: "Weeks 3-4",
                  title: "Recovery Phase",
                  desc: "Workout recovery noticeably improves. Reduced muscle soreness and faster bounce-back between sessions. Energy levels begin to rise.",
                },
                {
                  week: "Weeks 5-8",
                  title: "Transformation Phase",
                  desc: "Body composition changes become visible. Improved muscle tone, reduced body fat, better skin quality. Training performance reaches new levels.",
                },
                {
                  week: "Weeks 9-12",
                  title: "Peak Performance",
                  desc: "Full protocol benefits are realized. Sustained improvements across sleep, recovery, body composition, and overall vitality. This is your new baseline.",
                },
              ].map((phase) => (
                <motion.div
                  key={phase.week}
                  variants={fadeUp}
                  className="flex gap-8 items-start border-l border-accent/30 pl-8"
                >
                  <div className="min-w-[100px]">
                    <p className="text-accent text-sm tracking-wide">{phase.week}</p>
                  </div>
                  <div>
                    <h3 className="text-lg font-medium">{phase.title}</h3>
                    <p className="text-muted text-sm mt-2 leading-relaxed">{phase.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stack suggestion */}
      <section className="py-24 px-6 bg-card">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            variants={stagger}
            className="text-center"
          >
            <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
              Maximize Results
            </motion.p>
            <motion.h2 variants={fadeUp} className="text-4xl font-light tracking-tight">
              Stack with NAD+
            </motion.h2>
            <motion.p variants={fadeUp} className="mt-4 text-muted text-lg max-w-2xl mx-auto">
              Many of our top-performing members combine Sermorelin with NAD+ for comprehensive
              recovery and cellular optimization. Sermorelin drives growth and repair while NAD+
              fuels the cellular energy needed to sustain it.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex items-center justify-center gap-4">
              <button className="bg-accent text-background px-10 py-4 text-sm font-medium tracking-widest uppercase hover:bg-accent-light transition-colors">
                Start Sermorelin — $249/mo
              </button>
              <Link
                href="/products/nad"
                className="border border-card-border px-8 py-4 text-sm font-medium tracking-wide hover:border-muted transition-colors"
              >
                Add NAD+ — $189/mo
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-card-border py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold tracking-[0.2em] uppercase">Peppy</Link>
          <p className="text-xs text-muted">
            &copy; 2026 Peppy. These statements have not been evaluated by the FDA.
          </p>
        </div>
      </footer>
    </main>
  );
}

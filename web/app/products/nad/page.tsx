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

export default function NADPage() {
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
                Cellular Energy Revival
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-5xl md:text-6xl font-light tracking-tight leading-tight">
                NAD+
              </motion.h1>
              <motion.p variants={fadeUp} className="text-muted text-lg mt-6 leading-relaxed">
                Nicotinamide adenine dinucleotide — the essential coenzyme found in every living cell.
                NAD+ is critical for converting food into energy, maintaining DNA integrity, and
                regulating your body&apos;s internal clock.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-8 flex items-end gap-3">
                <span className="text-4xl font-light">$189</span>
                <span className="text-muted text-lg mb-1">/month</span>
              </motion.div>
              <motion.div variants={fadeUp} className="mt-8 flex gap-4">
                <button className="bg-accent text-background px-10 py-4 text-sm font-medium tracking-widest uppercase hover:bg-accent-light transition-colors">
                  Start Protocol
                </button>
                <Link
                  href="/products/sermorelin"
                  className="border border-card-border px-8 py-4 text-sm font-medium tracking-wide hover:border-muted transition-colors"
                >
                  View Sermorelin
                </Link>
              </motion.div>
            </div>

            {/* Product visual */}
            <motion.div
              variants={fadeUp}
              className="relative aspect-square bg-gradient-to-br from-card to-background border border-card-border flex items-center justify-center"
            >
              <div className="text-center">
                <div className="w-32 h-32 mx-auto rounded-full border border-accent/30 flex items-center justify-center bg-accent/5">
                  <span className="text-4xl font-extralight text-accent">N+</span>
                </div>
                <p className="text-muted text-xs tracking-widest uppercase mt-6">Pharmaceutical Grade</p>
                <p className="text-accent text-xs tracking-widest uppercase mt-1">99.7% Purity</p>
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
              Why NAD+
            </motion.p>
            <motion.h2 variants={fadeUp} className="text-4xl font-light tracking-tight">
              The foundation of cellular health
            </motion.h2>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-card-border">
            {[
              {
                title: "Energy Metabolism",
                desc: "NAD+ is essential for converting nutrients into ATP — the energy currency of your cells. More NAD+ means more efficient energy production.",
              },
              {
                title: "DNA Repair",
                desc: "Activates PARP enzymes that repair damaged DNA. Critical for preventing cellular aging and maintaining genomic stability.",
              },
              {
                title: "Sirtuin Activation",
                desc: "Fuels sirtuins — the \"longevity proteins\" that regulate inflammation, stress resistance, and metabolic health.",
              },
              {
                title: "Mitochondrial Function",
                desc: "Supports the powerhouses of your cells. Healthy mitochondria mean better endurance, recovery, and overall vitality.",
              },
              {
                title: "Circadian Rhythm",
                desc: "NAD+ levels naturally fluctuate with your circadian clock. Supplementation helps maintain healthy sleep-wake cycles.",
              },
              {
                title: "Neuroprotection",
                desc: "Supports brain health by protecting neurons from oxidative stress and promoting cognitive clarity and focus.",
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

      {/* Protocol section */}
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
                  title: "Foundation Phase",
                  desc: "Your body begins adjusting to increased NAD+ levels. Many members report improved sleep quality and subtle energy improvements.",
                },
                {
                  week: "Weeks 3-4",
                  title: "Activation Phase",
                  desc: "Noticeable improvements in daytime energy, mental clarity, and workout recovery. Your cellular machinery is ramping up.",
                },
                {
                  week: "Weeks 5-8",
                  title: "Optimization Phase",
                  desc: "Full benefits manifest — sustained energy throughout the day, faster recovery between sessions, improved skin quality, and enhanced focus.",
                },
                {
                  week: "Ongoing",
                  title: "Maintenance Phase",
                  desc: "Continued supplementation maintains elevated NAD+ levels. Regular bloodwork ensures your protocol stays optimized.",
                },
              ].map((phase) => (
                <motion.div
                  key={phase.week}
                  variants={fadeUp}
                  className="flex gap-8 items-start border-l border-card-border pl-8"
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

      {/* CTA */}
      <section className="py-24 px-6 bg-card">
        <motion.div
          className="max-w-2xl mx-auto text-center"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-4xl font-light tracking-tight">
            Start your NAD+ protocol
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted text-lg">
            Free consultation with a licensed provider. No commitments.
          </motion.p>
          <motion.div variants={fadeUp} className="mt-8">
            <button className="bg-accent text-background px-10 py-4 text-sm font-medium tracking-widest uppercase hover:bg-accent-light transition-colors">
              Get Started — $189/mo
            </button>
          </motion.div>
        </motion.div>
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

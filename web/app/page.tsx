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

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-card-border/50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-xl font-semibold tracking-[0.2em] uppercase">
          Peppy
        </Link>
        <div className="hidden md:flex items-center gap-10 text-sm tracking-wide">
          <a href="#products" className="text-muted hover:text-foreground transition-colors">
            Products
          </a>
          <a href="#science" className="text-muted hover:text-foreground transition-colors">
            Science
          </a>
          <a href="#results" className="text-muted hover:text-foreground transition-colors">
            Results
          </a>
          <a href="#faq" className="text-muted hover:text-foreground transition-colors">
            FAQ
          </a>
        </div>
        <a
          href="#products"
          className="bg-foreground text-background px-5 py-2 text-sm font-medium tracking-wide hover:bg-warm-white transition-colors"
        >
          Shop Now
        </a>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-card" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-accent/5 blur-3xl" />

      <motion.div
        className="relative z-10 max-w-4xl mx-auto px-6 text-center pt-24"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.p
          variants={fadeUp}
          className="text-accent tracking-[0.3em] uppercase text-sm mb-6"
        >
          Pharmaceutical-Grade Peptides
        </motion.p>
        <motion.h1
          variants={fadeUp}
          className="text-5xl md:text-7xl lg:text-8xl font-light tracking-tight leading-[0.95]"
        >
          Your body
          <br />
          <span className="italic font-extralight text-accent-light">deserves better.</span>
        </motion.h1>
        <motion.p
          variants={fadeUp}
          className="mt-8 text-lg md:text-xl text-muted max-w-2xl mx-auto leading-relaxed"
        >
          Clinically-backed peptides for recovery, energy, and longevity.
          Built for athletes who refuse to plateau.
        </motion.p>
        <motion.div variants={fadeUp} className="mt-10 flex items-center justify-center gap-4">
          <a
            href="#products"
            className="bg-accent text-background px-8 py-3.5 text-sm font-medium tracking-wide hover:bg-accent-light transition-colors"
          >
            Explore Products
          </a>
          <a
            href="#science"
            className="border border-card-border text-foreground px-8 py-3.5 text-sm font-medium tracking-wide hover:border-muted transition-colors"
          >
            The Science
          </a>
        </motion.div>

        {/* Stats bar */}
        <motion.div
          variants={fadeUp}
          className="mt-24 grid grid-cols-3 gap-8 max-w-lg mx-auto"
        >
          {[
            { value: "99.7%", label: "Purity" },
            { value: "50K+", label: "Customers" },
            { value: "3rd Party", label: "Tested" },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-2xl md:text-3xl font-light text-accent">{stat.value}</p>
              <p className="text-xs tracking-widest uppercase text-muted mt-1">{stat.label}</p>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
        animate={{ y: [0, 8, 0] }}
        transition={{ repeat: Infinity, duration: 2 }}
      >
        <svg width="20" height="30" viewBox="0 0 20 30" fill="none" className="text-muted">
          <rect x="1" y="1" width="18" height="28" rx="9" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="2.5" fill="currentColor" />
        </svg>
      </motion.div>
    </section>
  );
}

function Products() {
  const products = [
    {
      name: "NAD+",
      tagline: "Cellular Energy Revival",
      description:
        "Nicotinamide adenine dinucleotide. The coenzyme your cells depend on for energy metabolism, DNA repair, and mitochondrial function. Declining NAD+ levels are linked to aging and fatigue.",
      benefits: [
        "Boosts cellular energy production",
        "Supports DNA repair mechanisms",
        "Enhances mitochondrial function",
        "Promotes healthy aging pathways",
      ],
      price: "$189",
      period: "/month",
      href: "/products/nad",
      featured: false,
    },
    {
      name: "Sermorelin",
      tagline: "Growth. Recovery. Renewal.",
      description:
        "A growth hormone-releasing peptide that stimulates your pituitary gland naturally. Unlock deeper sleep, faster recovery, and the lean body composition you've been training for.",
      benefits: [
        "Stimulates natural GH production",
        "Accelerates post-workout recovery",
        "Improves sleep quality & depth",
        "Supports lean muscle & fat loss",
      ],
      price: "$249",
      period: "/month",
      href: "/products/sermorelin",
      featured: true,
    },
  ];

  return (
    <section id="products" className="py-32 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-20"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
            Our Products
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-light tracking-tight">
            Precision-engineered peptides
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted text-lg max-w-xl mx-auto">
            Every batch third-party tested. Every dose physician-formulated.
          </motion.p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-8">
          {products.map((product) => (
            <motion.div
              key={product.name}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-50px" }}
              variants={fadeUp}
            >
              <div
                className={`relative border p-10 md:p-12 h-full flex flex-col ${
                  product.featured
                    ? "border-accent/40 bg-gradient-to-b from-accent/5 to-transparent"
                    : "border-card-border bg-card"
                }`}
              >
                {product.featured && (
                  <div className="absolute top-0 right-0 bg-accent text-background text-xs tracking-widest uppercase px-4 py-1.5 font-medium">
                    Most Popular
                  </div>
                )}
                <p className="text-accent tracking-[0.2em] uppercase text-xs">{product.tagline}</p>
                <h3 className="text-3xl md:text-4xl font-light mt-3">{product.name}</h3>
                <p className="text-muted mt-4 leading-relaxed text-sm">{product.description}</p>

                <ul className="mt-8 space-y-3 flex-1">
                  {product.benefits.map((benefit) => (
                    <li key={benefit} className="flex items-start gap-3 text-sm">
                      <svg className="w-4 h-4 text-accent mt-0.5 shrink-0" viewBox="0 0 16 16" fill="none">
                        <path d="M2 8.5l4 4 8-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="text-foreground/80">{benefit}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-10 flex items-end justify-between">
                  <div>
                    <span className="text-3xl font-light">{product.price}</span>
                    <span className="text-muted text-sm">{product.period}</span>
                  </div>
                  <Link
                    href={product.href}
                    className={`px-8 py-3 text-sm font-medium tracking-wide transition-colors ${
                      product.featured
                        ? "bg-accent text-background hover:bg-accent-light"
                        : "bg-foreground text-background hover:bg-warm-white"
                    }`}
                  >
                    Learn More
                  </Link>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Science() {
  const steps = [
    {
      num: "01",
      title: "Consultation",
      description: "Quick online assessment with a licensed provider to ensure peptides are right for your goals.",
    },
    {
      num: "02",
      title: "Custom Protocol",
      description: "Your provider designs a personalized dosing schedule tailored to your training and recovery needs.",
    },
    {
      num: "03",
      title: "Delivered Monthly",
      description: "Pharmaceutical-grade peptides shipped discreetly to your door in temperature-controlled packaging.",
    },
    {
      num: "04",
      title: "Ongoing Support",
      description: "Regular check-ins and bloodwork tracking to optimize your protocol and maximize results.",
    },
  ];

  return (
    <section id="science" className="py-32 px-6 bg-card">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-20"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
            How It Works
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-light tracking-tight">
            Science meets simplicity
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted text-lg max-w-xl mx-auto">
            From consultation to delivery, we handle everything so you can focus on performing.
          </motion.p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-px bg-card-border">
          {steps.map((step) => (
            <motion.div
              key={step.num}
              className="bg-card p-8 md:p-10"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
            >
              <p className="text-accent text-3xl font-extralight">{step.num}</p>
              <h3 className="text-lg font-medium mt-4">{step.title}</h3>
              <p className="text-muted text-sm mt-3 leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Results() {
  const testimonials = [
    {
      quote: "I've tried every recovery protocol. Nothing has come close to what Peppy's NAD+ protocol did for my energy levels and training consistency.",
      name: "Sarah K.",
      role: "CrossFit Competitor",
      detail: "12 weeks on NAD+",
    },
    {
      quote: "My sleep is deeper, my recovery is faster, and my body composition has shifted noticeably. Sermorelin changed my game.",
      name: "Maya R.",
      role: "Marathon Runner",
      detail: "8 weeks on Sermorelin",
    },
    {
      quote: "As a trainer, I need to perform every day. The NAD+ protocol gives me sustained energy without the crash. My clients noticed the difference.",
      name: "Jordan L.",
      role: "Equinox Trainer",
      detail: "16 weeks on NAD+",
    },
  ];

  return (
    <section id="results" className="py-32 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-20"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
            Real Results
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-light tracking-tight">
            What our members say
          </motion.h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {testimonials.map((t) => (
            <motion.div
              key={t.name}
              className="border border-card-border p-8 md:p-10 flex flex-col"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={fadeUp}
            >
              {/* Stars */}
              <div className="flex gap-1 text-accent mb-6">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 1l2.1 4.3 4.7.7-3.4 3.3.8 4.7L8 11.8 3.8 14l.8-4.7L1.2 6l4.7-.7L8 1z" />
                  </svg>
                ))}
              </div>
              <p className="text-foreground/90 text-sm leading-relaxed flex-1 italic">
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="mt-8 pt-6 border-t border-card-border">
                <p className="font-medium text-sm">{t.name}</p>
                <p className="text-muted text-xs mt-0.5">{t.role}</p>
                <p className="text-accent text-xs mt-1">{t.detail}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const faqs = [
    {
      q: "Are peptides safe?",
      a: "Yes. Our peptides are pharmaceutical-grade, third-party tested, and prescribed by licensed providers. They have been extensively studied in clinical settings with strong safety profiles.",
    },
    {
      q: "Do I need a prescription?",
      a: "Yes. All Peppy peptides require a telehealth consultation with a licensed provider. This ensures your protocol is safe and tailored to your health profile.",
    },
    {
      q: "How quickly will I see results?",
      a: "Most members report noticeable improvements in energy and sleep within 2-3 weeks. Body composition and recovery benefits typically become apparent within 6-8 weeks.",
    },
    {
      q: "What's the difference between NAD+ and Sermorelin?",
      a: "NAD+ focuses on cellular energy, DNA repair, and mitochondrial health. Sermorelin stimulates natural growth hormone production for recovery, sleep, and lean muscle. Many members use both for comprehensive benefits.",
    },
    {
      q: "Can I cancel anytime?",
      a: "Absolutely. No contracts, no commitments. Cancel or pause your subscription anytime from your account dashboard.",
    },
  ];

  return (
    <section id="faq" className="py-32 px-6 bg-card">
      <div className="max-w-3xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.p variants={fadeUp} className="text-accent tracking-[0.3em] uppercase text-sm mb-4">
            FAQ
          </motion.p>
          <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-light tracking-tight">
            Questions? Answered.
          </motion.h2>
        </motion.div>

        <motion.div
          className="divide-y divide-card-border"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={stagger}
        >
          {faqs.map((faq) => (
            <motion.details
              key={faq.q}
              className="group py-6"
              variants={fadeUp}
            >
              <summary className="flex items-center justify-between cursor-pointer list-none text-lg font-light hover:text-accent transition-colors">
                {faq.q}
                <svg
                  className="w-5 h-5 text-muted group-open:rotate-45 transition-transform"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                </svg>
              </summary>
              <p className="mt-4 text-muted text-sm leading-relaxed max-w-2xl">
                {faq.a}
              </p>
            </motion.details>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-32 px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-card via-background to-background" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/5 blur-3xl" />
      <motion.div
        className="relative z-10 max-w-2xl mx-auto text-center"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-100px" }}
        variants={stagger}
      >
        <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-light tracking-tight">
          Ready to elevate<br />
          <span className="italic text-accent-light">your performance?</span>
        </motion.h2>
        <motion.p variants={fadeUp} className="mt-6 text-muted text-lg">
          Start your free consultation today. No commitments, no pressure.
          Just science-backed peptides, tailored to you.
        </motion.p>
        <motion.div variants={fadeUp} className="mt-10">
          <a
            href="#products"
            className="inline-block bg-accent text-background px-10 py-4 text-sm font-medium tracking-widest uppercase hover:bg-accent-light transition-colors"
          >
            Get Started
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-card-border py-16 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <p className="text-xl font-semibold tracking-[0.2em] uppercase">Peppy</p>
            <p className="text-muted text-sm mt-3 max-w-sm leading-relaxed">
              Premium peptide wellness for high-performers. Pharmaceutical-grade. Physician-supervised. Results-driven.
            </p>
          </div>
          <div>
            <p className="text-xs tracking-widest uppercase text-muted mb-4">Products</p>
            <ul className="space-y-2.5">
              <li>
                <Link href="/products/nad" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
                  NAD+
                </Link>
              </li>
              <li>
                <Link href="/products/sermorelin" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
                  Sermorelin
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs tracking-widest uppercase text-muted mb-4">Company</p>
            <ul className="space-y-2.5">
              <li>
                <a href="#science" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
                  How It Works
                </a>
              </li>
              <li>
                <a href="#faq" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
                  FAQ
                </a>
              </li>
              <li>
                <a href="#results" className="text-sm text-foreground/70 hover:text-foreground transition-colors">
                  Results
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-16 pt-8 border-t border-card-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted">
            &copy; 2026 Peppy. All rights reserved. These statements have not been evaluated by the FDA.
          </p>
          <div className="flex gap-6">
            <a href="#" className="text-xs text-muted hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="text-xs text-muted hover:text-foreground transition-colors">Terms</a>
            <a href="#" className="text-xs text-muted hover:text-foreground transition-colors">Contact</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <main>
      <Navbar />
      <Hero />
      <Products />
      <Science />
      <Results />
      <FAQ />
      <CTA />
      <Footer />
    </main>
  );
}

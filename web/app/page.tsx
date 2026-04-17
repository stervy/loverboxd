import Dashboard from "./dashboard";

export default function Home() {
  return (
    <main className="flex-1">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Hero */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold tracking-tight mb-3">
            lover<span className="text-accent">boxd</span>
          </h1>
          <p className="text-muted text-lg max-w-xl mx-auto">
            Your Letterboxd stats at a glance. Enter any public username to see
            rating distributions, top films, recent activity, and more.
          </p>
        </div>

        <Dashboard />

        {/* Footer */}
        <footer className="text-center text-muted text-sm mt-16 pb-8">
          <p>
            Not affiliated with Letterboxd. Data sourced from public profiles
            and RSS feeds.
          </p>
          {/* TMDB attribution — required by their API ToS whenever we use
               their metadata or images. */}
          <p className="mt-1 text-xs text-muted/70">
            Film posters and metadata courtesy of{" "}
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent/80 hover:text-accent underline"
            >
              The Movie Database (TMDB)
            </a>
            . This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
          <p className="mt-1">
            <a
              href="https://github.com/stervy/loverboxd"
              className="text-accent hover:text-accent-hover underline"
            >
              GitHub
            </a>
            {" "}
            &middot; Also available as a{" "}
            <code className="text-xs bg-card px-1.5 py-0.5 rounded">
              pip install
            </code>{" "}
            CLI tool
          </p>
        </footer>
      </div>
    </main>
  );
}

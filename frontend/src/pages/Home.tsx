import { useNavigate } from "react-router-dom";

export function Home() {
  const navigate = useNavigate();

  const scrollToFeatures = () => {
    document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background gradient effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0f] via-[#0f0f1a] to-[#0a0a0f]" />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-500/10 rounded-full blur-3xl" />

      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden">
        <div className="absolute top-20 left-10 w-72 h-72 bg-purple-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-6">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
            </span>
            <span className="text-sm text-purple-300">WebRTC Powered</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="bg-gradient-to-r from-purple-400 via-violet-400 to-purple-500 bg-clip-text text-transparent">
              Connect Face-to-Face
            </span>
          </h1>
          <p className="text-xl md:text-2xl text-zinc-400 mb-8 max-w-2xl mx-auto">
            Crystal-clear video meetings without the complexity. Start a secure
            room in seconds, no downloads required.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <button
              onClick={() => navigate("/landing")}
              className="px-8 py-4 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 rounded-xl font-semibold text-lg shadow-lg shadow-purple-500/25 transition-all hover:scale-105"
            >
              Start Meeting
            </button>
            <button
              onClick={scrollToFeatures}
              className="px-8 py-4 bg-white/5 hover:bg-purple-500/10 backdrop-blur-sm rounded-xl font-semibold text-lg border border-purple-500/30 transition-all"
            >
              How It Works
            </button>
          </div>

          <div className="relative mx-auto max-w-3xl">
            <div className="glass-strong rounded-2xl p-2 shadow-2xl shadow-purple-500/10">
              <div className="flex gap-2 mb-2 px-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="bg-[#0a0a0f] rounded-lg p-4 grid grid-cols-2 gap-4">
                <div className="aspect-video bg-gradient-to-br from-purple-900/30 to-violet-900/30 rounded-lg flex items-center justify-center border border-purple-500/20">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-600/50 to-violet-600/50 flex items-center justify-center border border-purple-500/30">
                    <svg
                      className="w-8 h-8 text-purple-300"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                    </svg>
                  </div>
                </div>
                <div className="aspect-video bg-gradient-to-br from-violet-900/30 to-purple-900/30 rounded-lg flex items-center justify-center border border-purple-500/20">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600/50 to-purple-600/50 flex items-center justify-center border border-purple-500/30">
                    <svg
                      className="w-8 h-8 text-violet-300"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 animate-bounce">
          <svg
            className="w-6 h-6 text-purple-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 14l-7 7m0 0l-7-7m7 7V3"
            />
          </svg>
        </div>
      </section>

      <section id="features" className="relative z-10 py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-white">
            Everything You Need
          </h2>
          <p className="text-zinc-400 text-center mb-16 max-w-xl mx-auto">
            Simple, secure, and powerful video conferencing built for modern
            teams
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            <div className="glass rounded-2xl p-8 border border-purple-500/20 hover:border-purple-500/40 transition-all group hover:shadow-lg hover:shadow-purple-500/10">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-600/20 to-violet-600/20 rounded-xl flex items-center justify-center mb-6 group-hover:from-purple-600/30 group-hover:to-violet-600/30 transition-colors border border-purple-500/30">
                <svg
                  className="w-7 h-7 text-purple-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-3 text-white">HD Video</h3>
              <p className="text-zinc-400">
                Crystal-clear video quality with adaptive streaming that works
                even on slower connections.
              </p>
            </div>

            <div className="glass rounded-2xl p-8 border border-purple-500/20 hover:border-purple-500/40 transition-all group hover:shadow-lg hover:shadow-purple-500/10">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-600/20 to-violet-600/20 rounded-xl flex items-center justify-center mb-6 group-hover:from-purple-600/30 group-hover:to-violet-600/30 transition-colors border border-purple-500/30">
                <svg
                  className="w-7 h-7 text-purple-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-3 text-white">Secure Rooms</h3>
              <p className="text-zinc-400">
                End-to-end encrypted calls with optional locked rooms. Rooms
                auto-expire after 24 hours.
              </p>
            </div>

            <div className="glass rounded-2xl p-8 border border-purple-500/20 hover:border-purple-500/40 transition-all group hover:shadow-lg hover:shadow-purple-500/10">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-600/20 to-violet-600/20 rounded-xl flex items-center justify-center mb-6 group-hover:from-purple-600/30 group-hover:to-violet-600/30 transition-colors border border-purple-500/30">
                <svg
                  className="w-7 h-7 text-purple-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1.581.814l-4.419-3.35-4.419 3.35A1 1 0 014 16V4zm6 5a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-3 text-white">No Install</h3>
              <p className="text-zinc-400">
                Works directly in your browser. No downloads, plugins, or
                account required to join.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="glass-strong rounded-3xl p-12 border border-purple-500/30">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
              Ready to Connect?
            </h2>
            <p className="text-zinc-300 mb-8 max-w-xl mx-auto">
              Start your first meeting in under 30 seconds. No credit card
              required.
            </p>
            <button
              onClick={() => navigate("/landing")}
              className="px-10 py-4 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white rounded-xl font-semibold text-lg transition-all hover:scale-105 shadow-lg shadow-purple-500/25"
            >
              Get Started Free
            </button>
          </div>
        </div>
      </section>

      <footer className="relative z-10 py-8 px-6 border-t border-purple-500/20">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-zinc-400 text-sm">
            © 2026 WebRTC Meet. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-zinc-400">
            <a href="#" className="hover:text-purple-400 transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-purple-400 transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-purple-400 transition-colors">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

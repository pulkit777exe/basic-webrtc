import { useNavigate } from "react-router-dom";

export function Home() {
  const navigate = useNavigate();

  const scrollToFeatures = () => {
    document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden">
        <div className="absolute top-20 left-10 w-72 h-72 bg-blue-600/30 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-600/30 rounded-full blur-3xl" />

        <div className="relative z-10 text-center max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Connect Face-to-Face
          </h1>
          <p className="text-xl md:text-2xl text-gray-300 mb-8 max-w-2xl mx-auto">
            Crystal-clear video meetings without the complexity. Start a secure
            room in seconds, no downloads required.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
            <button
              onClick={() => navigate("/landing")}
              className="px-8 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-semibold text-lg shadow-lg shadow-blue-500/25 transition-all hover:scale-105"
            >
              Start Meeting
            </button>
            <button
              onClick={scrollToFeatures}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-xl font-semibold text-lg border border-white/20 transition-all"
            >
              How It Works
            </button>
          </div>

          <div className="relative mx-auto max-w-3xl">
            <div className="bg-gray-800/50 backdrop-blur-xl rounded-2xl border border-gray-700 p-2 shadow-2xl">
              <div className="flex gap-2 mb-2 px-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="bg-gray-900 rounded-lg p-4 grid grid-cols-2 gap-4">
                <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-700 rounded-lg flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-blue-600/50 flex items-center justify-center">
                    <svg
                      className="w-8 h-8"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" />
                    </svg>
                  </div>
                </div>
                <div className="aspect-video bg-gradient-to-br from-gray-800 to-gray-700 rounded-lg flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-purple-600/50 flex items-center justify-center">
                    <svg
                      className="w-8 h-8"
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
            className="w-6 h-6 text-gray-400"
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

      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">
            Everything You Need
          </h2>
          <p className="text-gray-400 text-center mb-16 max-w-xl mx-auto">
            Simple, secure, and powerful video conferencing built for modern
            teams
          </p>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700 hover:border-blue-500/50 transition-all group">
              <div className="w-14 h-14 bg-blue-600/20 rounded-xl flex items-center justify-center mb-6 group-hover:bg-blue-600/30 transition-colors">
                <svg
                  className="w-7 h-7 text-blue-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold mb-3">HD Video</h3>
              <p className="text-gray-400">
                Crystal-clear video quality with adaptive streaming that works
                even on slower connections.
              </p>
            </div>

            <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700 hover:border-purple-500/50 transition-all group">
              <div className="w-14 h-14 bg-purple-600/20 rounded-xl flex items-center justify-center mb-6 group-hover:bg-purple-600/30 transition-colors">
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
              <h3 className="text-xl font-semibold mb-3">Secure Rooms</h3>
              <p className="text-gray-400">
                End-to-end encrypted calls with optional locked rooms. Rooms
                auto-expire after 24 hours.
              </p>
            </div>

            <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm rounded-2xl p-8 border border-gray-700 hover:border-pink-500/50 transition-all group">
              <div className="w-14 h-14 bg-pink-600/20 rounded-xl flex items-center justify-center mb-6 group-hover:bg-pink-600/30 transition-colors">
                <svg
                  className="w-7 h-7 text-pink-400"
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
              <h3 className="text-xl font-semibold mb-3">No Install</h3>
              <p className="text-gray-400">
                Works directly in your browser. No downloads, plugins, or
                account required to join.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 backdrop-blur-xl rounded-3xl p-12 border border-white/10">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Ready to Connect?
            </h2>
            <p className="text-gray-300 mb-8 max-w-xl mx-auto">
              Start your first meeting in under 30 seconds. No credit card
              required.
            </p>
            <button
              onClick={() => navigate("/landing")}
              className="px-10 py-4 bg-white text-gray-900 hover:bg-gray-100 rounded-xl font-semibold text-lg transition-all hover:scale-105"
            >
              Get Started Free
            </button>
          </div>
        </div>
      </section>

      <footer className="py-8 px-6 border-t border-gray-800">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-400 text-sm">
            © 2026 WebRTC Meet. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-gray-400">
            <a href="#" className="hover:text-white transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Terms
            </a>
            <a href="#" className="hover:text-white transition-colors">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

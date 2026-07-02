import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { sentryVitePlugin } from "@sentry/vite-plugin"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const sentryEnabled = !!env.SENTRY_AUTH_TOKEN;

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(sentryEnabled
        ? [
            sentryVitePlugin({
              org: "personal-2ao",
              project: "meetour",
              authToken: env.SENTRY_AUTH_TOKEN,
              sourcemaps: {
                assets: "./dist/assets/**",
              },
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return
            if (id.includes("react") || id.includes("scheduler")) return "vendor-react"
            if (id.includes("react-router-dom")) return "vendor-router"
            if (id.includes("gsap")) return "vendor-gsap"
            if (id.includes("radix-ui") || id.includes("@radix-ui")) return "vendor-radix"
            if (id.includes("jotai")) return "vendor-state"
            if (id.includes("lucide-react") || id.includes("sonner")) return "vendor-ui"
            return undefined
          },
        },
      },
    },
  }
})

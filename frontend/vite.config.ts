import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
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
})

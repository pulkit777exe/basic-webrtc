import { defineConfig, devices } from '@playwright/test';

const SIGNALING_PORT = 8787;
const VITE_PORT = 5173;

/**
 * Real-browser WebRTC rig.
 *
 * Two Chromium pages run the production peer module against a stub signaling
 * relay, so SDP, ICE, encoders and media are exercised for real — the surface
 * jsdom cannot reach and the reason simulcast stays disabled.
 *
 * The fake media flags give each page a synthetic camera and microphone, and
 * the loopback-only ICE policy keeps candidate gathering to host candidates so
 * the run needs no network and no STUN.
 */
export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${VITE_PORT}`,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera', 'microphone'],
        launchOptions: {
          args: [
            '--no-sandbox',
            // Synthetic camera/mic so the test needs no hardware.
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            // Loopback-only ICE: host candidates, no STUN/TURN, no network.
            '--force-webrtc-ip-handling-policy=default',
            '--allow-running-insecure-content',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      // cwd is the repo root, so the relay is at e2e/signaling-server.ts.
      command: `bun run e2e/signaling-server.ts ${SIGNALING_PORT}`,
      cwd: new URL('..', import.meta.url).pathname,
      port: SIGNALING_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    {
      // `--host 127.0.0.1` pins the bind address: Vite's default `localhost`
      // can resolve to IPv6 only, which the 127.0.0.1 baseURL cannot reach.
      // VITE_WS_URL is baked into the page by the dev server; the harness
      // defaults to the relay port, so this only has to be served.
      command: `bun run dev --port ${VITE_PORT} --strictPort --host 127.0.0.1`,
      cwd: new URL('../frontend', import.meta.url).pathname,
      port: VITE_PORT,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
  ],
});

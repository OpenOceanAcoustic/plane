import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.openoceanacoustic.mobile",
  appName: "OpenOceanAcoustic",
  webDir: "dist",
  loggingBehavior: "none",
  server: { androidScheme: "https", hostname: "localhost" },
  // Internal HTTP deployments use ws:// collaboration from the bundled https://localhost UI.
  android: { allowMixedContent: true, webContentsDebuggingEnabled: false, minWebViewVersion: 95 },
  plugins: {
    CapacitorHttp: { enabled: false },
    CapacitorCookies: { enabled: false },
    Keyboard: { resizeOnFullScreen: true },
    SystemBars: { insetsHandling: "disable" },
  },
};

export default config;

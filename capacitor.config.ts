import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell for Atlas Commerce (Android APK + optional iOS).
 *
 * Phone = floor operator (scan, stock glance, quick sales).
 * PC browser = full desk (sidebar, invoices, settings).
 * Both talk to the same Cloudflare Worker API (see src/config.ts).
 *
 * webDir: Vite + @cloudflare/vite-plugin usually emits SPA under dist/client.
 * If your build only has dist/index.html, change webDir to 'dist' and rebuild.
 */
const config: CapacitorConfig = {
  appId: 'ma.etherealmber.atlascommerce',
  appName: 'Atlas Commerce',
  webDir: 'dist/client',
  server: {
    androidScheme: 'https',
    // Optional: load live site in WebView instead of bundled assets
    // url: 'https://stock.afmarbre.com',
    // cleartext: false,
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#0B1F1A',
  },
  ios: {
    backgroundColor: '#0B1F1A',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0B1F1A',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      splashFullScreen: true,
      splashImmersive: true,
      androidScaleType: 'CENTER_INSIDE',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0B1F1A',
    },
  },
};

export default config;

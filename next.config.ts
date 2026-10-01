import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Where product images may come from: Unsplash (the sample catalog) and uploads to Vercel Blob. */
const IMAGE_HOSTS = ["https://images.unsplash.com", "https://*.public.blob.vercel-storage.com"];

/**
 * Without nonces, so pages stay static (ISR); Next needs inline scripts and styles. Payment happens
 * on Paystack's own page, reached by a redirect, so only `form-action` names it (a form submitted
 * before hydration redirects there). Development serves over http and needs eval for hot reload.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${IMAGE_HOSTS.join(" ")}`,
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.paystack.com",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Browsers ignore HSTS over http, so it's harmless locally, but it's only sent in production.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com", pathname: "/**" },
    ],
  },
  experimental: {
    // Admin image uploads go through a Server Function: up to 4 MB per image, plus form overhead.
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

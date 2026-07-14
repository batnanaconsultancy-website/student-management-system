import tailwindcss from "@tailwindcss/vite";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",

  devtools: { enabled: true },

  modules: [
    "@nuxt/ui",
    "@nuxt/icon",
    "@nuxtjs/supabase",
    "@nuxtjs/color-mode",
    "nuxt-charts",
    "@vueuse/nuxt",
    "@nuxt/fonts",
    "@nuxt/image",
    "nuxt-nodemailer",
  ],
  plugins: [],
  css: ["~/assets/css/main.css"],

  // ✅ ADD THIS SECTION
  nitro: {
    preset: "vercel",
    externals: {
      // Force googleapis to be bundled instead of treated as external
      inline: ["googleapis"],
    },
  },

  supabase: {
    url: process.env.NUXT_PUBLIC_SUPABASE_URL,
    key: process.env.NUXT_PUBLIC_SUPABASE_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_KEY,
    redirectOptions: {
      login: "/", // User will be redirected to this path if not authenticated or after logout.
      callback: "/auth/confirm", // This is the path the user will be redirect to after supabase login redirection.
      include: undefined, // Routes to include in the redirect. ['/admin(/*)?'] will enable the redirect only for the admin page and all sub-pages.
      exclude: ["/"],
      cookieRedirect: false,
    },
  },

  nodemailer: {
    from:
      process.env.NUXT_NODEMAILER_FROM ||
      '"Student Management System" <notifications@yourdomain.com>',
    host: process.env.NUXT_NODEMAILER_HOST || "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.NUXT_NODEMAILER_AUTH_USER || "",
      pass: process.env.NUXT_NODEMAILER_AUTH_PASS || "",
    },
  },

  runtimeConfig: {
    // Credentials - server-side only for security
    scraperUsername: process.env.SCRAPER_USERNAME,
    scraperPassword: process.env.SCRAPER_PASSWORD,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // Keys within public are also exposed client-side
    public: {
      googleClientId: process.env.NUXT_PUBLIC_GOOGLE_CLIENT_ID,
      googleClientSecret: process.env.NUXT_PUBLIC_GOOGLE_CLIENT_SECRET,
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL,
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY,
    },
  },

  app: {
    head: {
      link: [{ rel: "preload", as: "image", href: "/favicon.png" }],
    },
  },

  imports: {
    imports: [
      {
        from: "tailwind-variants",
        name: "tv",
      },
      {
        from: "tailwind-variants",
        name: "VariantProps",
        type: true,
      },
    ],
  },

  colorMode: {
    storageKey: "Final_Project-color-mode",
    classSuffix: "",
  },

  icon: {
    clientBundle: {
      scan: true,
      sizeLimitKb: 0,
    },

    mode: "svg",
    class: "shrink-0",
    fetchTimeout: 2000,
    serverBundle: "local",
  },
  experimental: {
    componentIslands: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});

// const runtimeConfig = useRuntimeConfig()

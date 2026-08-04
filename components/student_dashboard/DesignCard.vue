<script setup>
  // Purely decorative illustration card — no data dependencies.
  // Uses the app's theme CSS variables (assets/css) so it adapts to dark mode automatically.
</script>

<template>
  <UCard
    variant="outline"
    class="design-card relative w-full overflow-hidden"
    :ui="{
      body: '!p-0',
    }"
  >
    <div class="relative flex w-full flex-col items-center justify-center gap-3 px-6 py-8 xl:py-10">
      <!-- Soft blurred color blobs behind the illustration -->
      <div class="pointer-events-none absolute inset-0 overflow-hidden">
        <div class="blob blob-a" />
        <div class="blob blob-b" />
        <div class="blob blob-c" />
      </div>

      <svg
        class="relative w-full max-w-[380px]"
        viewBox="0 0 400 240"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="dc-rocket-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-glacier-300)" />
            <stop offset="100%" stop-color="var(--color-blue-500)" />
          </linearGradient>
          <linearGradient id="dc-flame" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--color-amber-500)" />
            <stop offset="100%" stop-color="var(--color-orange-500)" />
          </linearGradient>
          <linearGradient id="dc-window" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--color-esmerald-300)" />
            <stop offset="100%" stop-color="var(--color-teal-500)" />
          </linearGradient>
          <linearGradient id="dc-planet" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--color-fuchsia-500)" />
            <stop offset="100%" stop-color="var(--color-purple-500)" />
          </linearGradient>
          <radialGradient id="dc-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="var(--color-sky-500)" stop-opacity="0.35" />
            <stop offset="100%" stop-color="var(--color-sky-500)" stop-opacity="0" />
          </radialGradient>
        </defs>

        <!-- ambient glow -->
        <circle cx="200" cy="120" r="110" fill="url(#dc-glow)" />

        <!-- orbiting ring/planet, back layer -->
        <g transform="translate(316 66)">
          <ellipse cx="0" cy="0" rx="26" ry="9" fill="none" stroke="var(--color-violet-500)" stroke-width="2.5" opacity="0.6" transform="rotate(-18)" />
          <circle cx="0" cy="0" r="13" fill="url(#dc-planet)" />
          <circle cx="-4" cy="-4" r="3.5" fill="white" opacity="0.35" />
        </g>

        <!-- small planet bottom-left -->
        <g transform="translate(56 172)">
          <circle cx="0" cy="0" r="16" fill="var(--color-cyan-500)" opacity="0.9" />
          <path d="M -16 -3 Q 0 6 16 -3" stroke="var(--color-teal-800)" stroke-width="2" fill="none" opacity="0.35" />
          <circle cx="-5" cy="-6" r="3" fill="white" opacity="0.3" />
        </g>

        <!-- stars / sparkles -->
        <g fill="var(--color-lime-500)">
          <path d="M70 46 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z" />
        </g>
        <g fill="var(--color-amber-500)">
          <path d="M330 150 l2.4 6.4 6.4 2.4 -6.4 2.4 -2.4 6.4 -2.4 -6.4 -6.4 -2.4 6.4 -2.4 z" />
        </g>
        <g fill="var(--color-fuchsia-500)">
          <circle cx="120" cy="34" r="3" />
        </g>
        <g fill="var(--color-sky-500)">
          <circle cx="286" cy="196" r="3" />
        </g>
        <g fill="var(--color-indigo-500)">
          <circle cx="44" cy="96" r="2.5" />
        </g>

        <!-- rocket trail sparkle dots -->
        <g opacity="0.85">
          <circle cx="176" cy="188" r="2.5" fill="var(--color-orange-500)" />
          <circle cx="164" cy="196" r="2" fill="var(--color-amber-500)" />
          <circle cx="188" cy="200" r="1.8" fill="var(--color-esmerald-500)" />
        </g>

        <!-- rocket -->
        <g transform="translate(200 118) rotate(-18)">
          <!-- flame -->
          <path d="M -9 46 Q 0 74 9 46 Q 0 58 -9 46 Z" fill="url(#dc-flame)" />
          <path d="M -4 46 Q 0 62 4 46 Q 0 54 -4 46 Z" fill="var(--color-yellow-300)" opacity="0.9" />

          <!-- fins -->
          <path d="M -12 30 Q -30 40 -22 54 L -9 42 Z" fill="var(--color-indigo-500)" />
          <path d="M 12 30 Q 30 40 22 54 L 9 42 Z" fill="var(--color-violet-500)" />

          <!-- body -->
          <path
            d="M 0 -58 C 20 -40 22 6 16 40 L -16 40 C -22 6 -20 -40 0 -58 Z"
            fill="url(#dc-rocket-body)"
            stroke="var(--color-blue-700)"
            stroke-width="1.5"
          />

          <!-- nose highlight -->
          <path d="M 0 -58 C 10 -46 13 -24 13 -8 L 2 -8 C 2 -28 -2 -46 0 -58 Z" fill="white" opacity="0.18" />

          <!-- window -->
          <circle cx="0" cy="-6" r="12" fill="white" />
          <circle cx="0" cy="-6" r="9.5" fill="url(#dc-window)" />
          <circle cx="-3" cy="-9" r="2.6" fill="white" opacity="0.55" />
        </g>
      </svg>

      <div class="relative flex flex-col items-center gap-0.5 text-center">
        <p class="text-highlighted text-sm font-semibold xl:text-base">Keep building</p>
        <p class="text-muted text-xs xl:text-sm">Every commit gets you closer to launch</p>
      </div>
    </div>
  </UCard>
</template>

<style scoped>
.design-card {
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--color-glacier-100) 70%, transparent),
    color-mix(in srgb, var(--color-purple-100) 60%, transparent) 45%,
    color-mix(in srgb, var(--color-orange-100) 55%, transparent)
  );
}

.blob {
  position: absolute;
  border-radius: 9999px;
  filter: blur(28px);
  opacity: 0.45;
}

.blob-a {
  top: -40px;
  left: -30px;
  width: 160px;
  height: 160px;
  background: var(--color-cyan-500);
}

.blob-b {
  bottom: -50px;
  right: -20px;
  width: 180px;
  height: 180px;
  background: var(--color-fuchsia-500);
}

.blob-c {
  bottom: 10px;
  left: 30%;
  width: 120px;
  height: 120px;
  background: var(--color-amber-500);
  opacity: 0.3;
}
</style>

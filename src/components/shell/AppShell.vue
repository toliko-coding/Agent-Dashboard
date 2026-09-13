<template>
  <div class="h-screen flex flex-col bg-app text-fg font-sans">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded focus:text-sm focus:font-semibold"
    >Skip to main content</a>

    <div class="flex-1 flex min-h-0">
      <slot name="sidebar" />
      <div class="flex-1 flex flex-col min-w-0">
        <slot name="topbar" />
        <!--
          `relative` makes this scroll container the containing block for every
          absolutely positioned descendant. Without it, an element with no
          positioned ancestor — Tailwind's sr-only is position:absolute — is
          placed against the initial containing block instead, so its offset deep
          inside a long view stretched the whole document: LocalScope grew the
          page to ~4.7k px and pushed the status bar mid-screen, and Workflows
          added 814px the same way. Content still scrolls here, and only here.
        -->
        <main id="main-content" tabindex="-1" class="relative flex-1 min-h-0 overflow-y-auto" style="scroll-margin-top: 48px">
          <slot />
        </main>
      </div>
    </div>

    <slot name="statusbar" />
  </div>
</template>

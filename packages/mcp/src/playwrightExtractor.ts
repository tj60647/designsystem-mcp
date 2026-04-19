/**
 * Design System MCP — Playwright Headless Extractor
 * Author: Thomas J McLeish
 * License: MIT
 *
 * Uses a headless Chromium browser to extract *computed* design values from a
 * live website. Unlike the fetch-based extractor, this runs the page's
 * JavaScript (CSS-in-JS, Tailwind JIT, Next.js, etc.) before reading styles,
 * so the values reflect exactly what a real browser would render.
 *
 * ── What it collects ─────────────────────────────────────────────────────
 *   • CSS custom properties set on :root (highest signal — many design
 *     systems publish their token palette here)
 *   • Computed color, background-color, font-family, font-size, and
 *     border-radius values sampled from key DOM elements: body, h1, first
 *     button, first <a>, first <input>, first <nav>
 *   • All font family names that have loaded (via document.fonts)
 *
 * ── Fallback behaviour ───────────────────────────────────────────────────
 *   This module is dynamically imported so the server starts cleanly even if
 *   the Playwright browsers are not installed. If the import or the browser
 *   launch fails, the caller (websiteExtractor.ts) catches the error and
 *   falls back to the plain fetch-based pipeline.
 *
 * ── Security ────────────────────────────────────────────────────────────
 *   • The URL must already be validated by validateWebsiteUrl() before being
 *     passed here (SSRF guard lives in the caller).
 *   • The browser context is isolated (no stored cookies/sessions).
 *   • No screenshot is saved to disk or sent anywhere.
 *   • The browser is always closed in the `finally` block.
 */

/** Shape returned to websiteExtractor.ts — mirrors extractCssDesignTokens output. */
export interface PlaywrightExtractResult {
  variables:   Record<string, string>;
  colors:      string[];
  fonts:       string[];
  borderRadii: string[];
  fontSizes:   string[];
  /** True when Playwright was actually used (not a fallback empty result). */
  success:     boolean;
}

const NAVIGATION_TIMEOUT_MS = 20_000;

/**
 * Launch a headless browser, navigate to `url`, and extract computed design
 * values from the live page. The browser is always closed when done.
 *
 * Throws if the `playwright` package is unavailable or browser launch fails —
 * the caller should catch this and fall back to the fetch-based extractor.
 */
export async function extractWithPlaywright(url: string): Promise<PlaywrightExtractResult> {
  // Dynamic import so the module can be loaded even when `playwright` is not
  // installed. If the import fails it propagates to the caller.
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // Appear as a normal desktop browser to avoid bot-detection redirects
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    // No stored state — each extraction is a clean session
    storageState: undefined,
  });

  try {
    const page = await context.newPage();

    // Block heavyweight resources that don't affect CSS: images, media, fonts
    // (fonts are already loaded via the CSS engine; we read names not files).
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) {
        route.abort().catch(() => {/* ignore */});
      } else {
        route.continue().catch(() => {/* ignore */});
      }
    });

    // Navigate and wait until no more network activity (CSS-in-JS needs this)
    await page.goto(url, {
      waitUntil:  "networkidle",
      timeout:    NAVIGATION_TIMEOUT_MS,
    });

    // Wait for fonts to finish loading so font-family reads are accurate
    await page.evaluate(() => document.fonts.ready).catch(() => {/* non-fatal */});

    // ── Extract computed values inside the browser context ─────────────────
    const extracted = await page.evaluate(() => {
      const variables:  Record<string, string> = {};
      const colorsSet:  Set<string> = new Set();
      const fontsSet:   Set<string> = new Set();
      const radiiSet:   Set<string> = new Set();
      const sizesSet:   Set<string> = new Set();

      // 1. CSS custom properties on :root ───────────────────────────────────
      //    getComputedStyle gives resolved values even for variables set via JS.
      const rootStyle = getComputedStyle(document.documentElement);
      // Iterate all in-document stylesheets to find --variable names, then
      // resolve their computed values from :root.
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(sheet.cssRules ?? []);
          for (const rule of rules) {
            if (!(rule instanceof CSSStyleRule)) continue;
            const decl = rule.style;
            for (let i = 0; i < decl.length; i++) {
              const prop = decl[i];
              if (prop.startsWith("--")) {
                const value = rootStyle.getPropertyValue(prop).trim();
                if (value && value.length < 200) {
                  variables[prop.slice(2)] = value; // strip leading --
                }
              }
            }
          }
        } catch {
          // Cross-origin stylesheets throw SecurityError — skip silently
        }
      }

      // 2. Computed styles sampled from key page elements ───────────────────
      //    These give real rendered values even on Tailwind/CSS-in-JS sites.
      const selectors = [
        "body",
        "h1",
        "button",
        "a",
        "input",
        "nav",
        "[class*='btn']",
        "[class*='button']",
        "[class*='card']",
        "[class*='primary']",
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);

        // Colors
        for (const prop of ["color", "backgroundColor", "borderColor"]) {
          const val = cs.getPropertyValue(
            prop.replace(/([A-Z])/g, "-$1").toLowerCase(),
          ).trim();
          if (val && val !== "rgba(0, 0, 0, 0)" && val !== "transparent") {
            colorsSet.add(val);
          }
        }

        // Font families — take first family in the stack
        const ff = cs.fontFamily?.replace(/['"`]/g, "").split(",")[0].trim();
        if (ff && !["inherit", "initial", "unset", ""].includes(ff)) {
          fontsSet.add(ff);
        }

        // Font sizes
        const fs = cs.fontSize?.trim();
        if (fs && /^\d/.test(fs)) sizesSet.add(fs);

        // Border radii — only simple single-token values
        const br = cs.borderRadius?.trim();
        if (br && /^[\d.]+(?:px|rem|em|%)$/.test(br)) radiiSet.add(br);
      }

      // 3. Loaded font faces (document.fonts) ───────────────────────────────
      document.fonts.forEach((face) => {
        const family = face.family.replace(/['"`]/g, "").trim();
        if (family) fontsSet.add(family);
      });

      return {
        variables,
        colors:      Array.from(colorsSet).slice(0, 50),
        fonts:       Array.from(fontsSet).slice(0, 10),
        borderRadii: Array.from(radiiSet).slice(0, 8),
        fontSizes:   Array.from(sizesSet).slice(0, 10),
      };
    });

    return { ...extracted, success: true };
  } finally {
    // Always close the browser — even if extraction throws
    await browser.close().catch(() => {/* ignore close errors */});
  }
}

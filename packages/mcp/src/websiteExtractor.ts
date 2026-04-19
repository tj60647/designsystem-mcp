/**
 * Design System MCP — Website Design Context Extractor
 *
 * Fetches a public website and extracts design-relevant information to use
 * as context when generating a design system with AI.
 *
 * Extraction strategies (in order of reliability):
 *   1. CSS custom properties (--token: value) — highest signal, many design systems publish these
 *   2. Hex / functional color values parsed from all CSS text
 *   3. font-family, font-size, border-radius, and spacing values parsed from CSS
 *   4. <meta name="theme-color"> — browser tab / PWA brand color hint
 *   5. Web App Manifest (manifest.json) — theme_color and background_color
 *   6. CSS framework detection (Tailwind, Bootstrap, Material) inferred from class names and sheet URLs
 *   7. <meta name="description"> / og:site_name / page title — brand / product context
 *   8. Sparse-CSS fallback — if fewer than MIN_SIGNALS are found, the AI prompt explicitly
 *      instructs the model to infer a plausible design system from the brand name and URL.
 *
 * ── Playwright strategy ───────────────────────────────────────────────────────
 *   When the `playwright` package is installed and a Chromium browser is available,
 *   the extractor runs strategies 1-7 inside a *live headless browser* instead of
 *   parsing raw HTML/CSS text. This means:
 *     • CSS-in-JS (Styled Components, Emotion, Stitches) styles are captured after
 *       JavaScript runs and injects the <style> tags.
 *     • Tailwind JIT classes resolve to real computed values (px, hex, etc.).
 *     • SPA / Next.js / Remix pages that build UI client-side are fully rendered.
 *   If Playwright is unavailable or the browser launch fails, the extractor falls
 *   back to the plain fetch+CSS-parse pipeline transparently.
 */

import type { PlaywrightExtractResult } from "./playwrightExtractor.js";

/** Allowed protocols for safety */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Reject private/loopback IP ranges to prevent SSRF */
function isPrivateHostname(hostname: string): boolean {
  // Strip IPv6 brackets so pattern checks work uniformly
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  // IPv4 loopback and well-known hostnames
  if (bare === "localhost" || bare === "127.0.0.1") return true;

  // IPv6 loopback (::1 and its verbose equivalents)
  if (bare === "::1" || bare === "0:0:0:0:0:0:0:1") return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — recursively check the embedded address
  const ipv4Mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) return isPrivateHostname(ipv4Mapped[1]);
  // Hex-encoded IPv4-mapped form (::ffff:xxxx:xxxx) — block entire ::ffff: range conservatively
  if (/^::ffff:/i.test(bare)) return true;

  // IPv6 link-local (fe80::/10 — fe80 through febf)
  if (/^fe[89ab]/i.test(bare)) return true;

  // IPv6 Unique Local Address (fc00::/7 — fc00 through fdff)
  if (/^f[cd]/i.test(bare)) return true;

  // IPv4 private ranges
  if (/^10\.\d+\.\d+\.\d+$/.test(bare)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(bare)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(bare)) return true;

  // CGNAT (100.64.0.0/10 = 100.64.x.x – 100.127.x.x)
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(bare)) return true;

  // Link-local / unspecified IPv4
  if (/^0\./.test(bare)) return true;
  if (/^169\.254\./.test(bare)) return true;

  return false;
}

/**
 * Validate and parse a URL, throwing on unsafe or malformed input.
 */
export function validateWebsiteUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("Only http:// and https:// URLs are allowed.");
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new Error("URLs pointing to private or loopback addresses are not allowed.");
  }

  return parsed;
}

/**
 * Extract CSS custom properties and design-relevant values from raw CSS text.
 * Returns variables, colors, fonts, border-radius values, and font-size values.
 */
function extractCssDesignTokens(css: string): {
  variables: Record<string, string>;
  colors: string[];
  fonts: string[];
  borderRadii: string[];
  fontSizes: string[];
} {
  const variables: Record<string, string> = {};
  const colorsSet       = new Set<string>();
  const fontsSet        = new Set<string>();
  const borderRadiiSet  = new Set<string>();
  const fontSizesSet    = new Set<string>();

  // CSS custom properties: --name: value;
  const varRegex = /--([\w-]+)\s*:\s*([^;{}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = varRegex.exec(css)) !== null) {
    const name  = m[1].trim();
    const value = m[2].trim();
    if (value && value.length < 200) {
      variables[name] = value;
    }
  }

  // Hex colors (#rgb, #rrggbb, #rrggbbaa)
  const hexRegex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3})\b/g;
  while ((m = hexRegex.exec(css)) !== null) {
    colorsSet.add(m[0].toLowerCase());
  }

  // Functional color notations
  const funcColorRegex = /(?:rgb|rgba|hsl|hsla)\([^)]+\)/g;
  while ((m = funcColorRegex.exec(css)) !== null) {
    colorsSet.add(m[0]);
  }

  // font-family declarations
  const fontRegex = /font-family\s*:\s*([^;}{]+)/g;
  while ((m = fontRegex.exec(css)) !== null) {
    const font = m[1].trim().replace(/['"`]/g, "").split(",")[0].trim();
    if (font && font !== "inherit" && font !== "initial" && font !== "unset") {
      fontsSet.add(font);
    }
  }

  // border-radius declarations (captures px, rem, em, % values)
  const borderRadiusRegex = /border-radius\s*:\s*([^;}{]+)/g;
  while ((m = borderRadiusRegex.exec(css)) !== null) {
    const val = m[1].trim();
    // Only keep simple single-value declarations (not shorthand with 4 parts)
    if (/^[\d.]+(?:px|rem|em|%)$/.test(val)) borderRadiiSet.add(val);
  }

  // font-size declarations
  const fontSizeRegex = /font-size\s*:\s*([\d.]+(?:px|rem|em))/g;
  while ((m = fontSizeRegex.exec(css)) !== null) {
    fontSizesSet.add(m[1].trim());
  }

  return {
    variables,
    colors:       Array.from(colorsSet).slice(0, 50),
    fonts:        Array.from(fontsSet).slice(0, 10),
    borderRadii:  Array.from(borderRadiiSet).slice(0, 8),
    fontSizes:    Array.from(fontSizesSet).slice(0, 10),
  };
}

/**
 * Detect which CSS framework(s) are likely in use on the page.
 * Checks stylesheet URLs and a sample of HTML class attribute values.
 */
function detectCssFrameworks(html: string, sheetUrls: string[]): string[] {
  const detected: string[] = [];

  // Check stylesheet URLs for well-known CDN paths
  const allUrls = sheetUrls.join(" ").toLowerCase();
  if (/tailwind/.test(allUrls))                        detected.push("Tailwind CSS");
  if (/bootstrap/.test(allUrls))                       detected.push("Bootstrap");
  if (/material|mdc-/.test(allUrls))                   detected.push("Material Design");
  if (/foundation/.test(allUrls))                      detected.push("Foundation");
  if (/chakra/.test(allUrls))                          detected.push("Chakra UI");
  if (/antd|ant-design/.test(allUrls))                 detected.push("Ant Design");

  if (detected.length > 0) return detected;

  // Sample the first 20 000 chars of HTML for telltale class patterns
  const sample = html.slice(0, 20_000);

  // Tailwind: utility classes like text-sm, bg-blue-500, px-4, rounded-lg
  const tailwindClassCount = (sample.match(/\bclass="[^"]*(?:text-(?:sm|base|lg|xl)|bg-(?:\w+-\d+)|px-\d+|py-\d+|rounded(?:-\w+)?|flex|grid|gap-\d+)[^"]*"/g) ?? []).length;
  if (tailwindClassCount >= 3) detected.push("Tailwind CSS");

  // Bootstrap: btn, col-*, container, navbar
  const bootstrapClassCount = (sample.match(/\bclass="[^"]*(?:btn|col-\w+-\d+|container|navbar|row\b)[^"]*"/g) ?? []).length;
  if (bootstrapClassCount >= 3) detected.push("Bootstrap");

  // Material: mdc-, MuiButton, v-btn etc.
  if (/mdc-|MuiButton|v-btn/.test(sample)) detected.push("Material Design");

  return detected;
}

const FETCH_TIMEOUT_MS   = 15_000;
const MAX_HTML_BYTES     = 500_000;
const MAX_CSS_BYTES      = 100_000;
const MAX_STYLESHEETS    = 5;   // increased from 3 to catch more CSS sources

/**
 * Minimum number of distinct design signals (variables + colors + fonts)
 * before we consider the extraction "rich". Below this the prompt gets an
 * explicit infer-from-brand instruction so the AI doesn't produce empty output.
 */
const MIN_SIGNALS = 5;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "DesignSystemMCP/0.3.0 (design token extractor)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a public website and extract design-relevant context.
 * Returns a textual description suitable for passing to `generateDesignSystem`.
 *
 * Extraction order:
 *   1. Playwright headless browser (if available) — reads computed/live styles
 *      after JS runs; captures CSS-in-JS, Tailwind JIT, SPA-rendered pages
 *   2. Page HTML (title, meta description, og:site_name, theme-color, manifest link)
 *   3. Web App Manifest (theme_color, background_color)
 *   4. Inline <style> tags + external stylesheets (up to MAX_STYLESHEETS)
 *      (only used when Playwright extraction was not attempted / unavailable)
 *   5. CSS parsing (custom properties, colors, fonts, border-radius, font-sizes)
 *   6. CSS framework detection from class names and sheet URLs
 *   7. Sparse-CSS fallback instruction when signals are few
 */
export async function extractWebsiteDesignContext(rawUrl: string): Promise<string> {
  const parsed  = validateWebsiteUrl(rawUrl);
  const baseUrl = parsed.origin;

  // ── 1. Try Playwright headless extraction ────────────────────────────────
  let pwResult: PlaywrightExtractResult | null = null;
  try {
    const { extractWithPlaywright } = await import("./playwrightExtractor.js");
    pwResult = await extractWithPlaywright(parsed.href);
  } catch {
    // Playwright not installed, browser unavailable, or navigation failed —
    // fall through to the fetch-based pipeline below.
    pwResult = null;
  }

  // ── 2. Fetch page HTML (always needed for meta signals) ──────────────────
  let html: string;
  try {
    const res = await fetchWithTimeout(parsed.href, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    html = text.slice(0, MAX_HTML_BYTES);
  } catch (err) {
    throw new Error(`Could not fetch website: ${String(err)}`);
  }

  // ── 3. Extract HTML meta signals ─────────────────────────────────────────
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle  = titleMatch ? titleMatch[1].trim() : parsed.hostname;

  const metaDescMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i,
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  );
  const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : "";

  const ogSiteNameMatch = html.match(
    /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i,
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i,
  );
  const ogSiteName = ogSiteNameMatch ? ogSiteNameMatch[1].trim() : "";

  // <meta name="theme-color" content="#hexvalue"> — browser / PWA brand color
  const themeColorMatch = html.match(
    /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i,
  ) ?? html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i,
  );
  const metaThemeColor = themeColorMatch ? themeColorMatch[1].trim() : "";

  // ── 4. Web App Manifest ───────────────────────────────────────────────────
  let manifestThemeColor      = "";
  let manifestBackgroundColor = "";
  const manifestHrefMatch = html.match(
    /<link[^>]+rel=["']manifest["'][^>]*href=["']([^"']+)["']/i,
  ) ?? html.match(
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']manifest["']/i,
  );
  if (manifestHrefMatch) {
    try {
      const manifestUrl = new URL(manifestHrefMatch[1], baseUrl).href;
      validateWebsiteUrl(manifestUrl);
      const mRes = await fetchWithTimeout(manifestUrl, FETCH_TIMEOUT_MS);
      if (mRes.ok) {
        const mJson = await mRes.json() as Record<string, unknown>;
        if (typeof mJson.theme_color      === "string") manifestThemeColor      = mJson.theme_color;
        if (typeof mJson.background_color === "string") manifestBackgroundColor = mJson.background_color;
      }
    } catch { /* silently skip missing/invalid manifest */ }
  }

  // ── 5. Collect CSS signals (only when Playwright was not used) ────────────
  // When Playwright ran successfully we already have richer computed values;
  // the raw CSS parse is redundant and potentially noisier.
  let cssVariables:  Record<string, string> = {};
  let cssColors:     string[] = [];
  let cssFonts:      string[] = [];
  let cssBorderRadii: string[] = [];
  let cssFontSizes:  string[] = [];
  let frameworks:    string[] = [];
  const sheetUrls:   string[] = [];

  if (!pwResult?.success) {
    const cssChunks: string[] = [];

    const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let sm: RegExpExecArray | null;
    while ((sm = styleTagRegex.exec(html)) !== null) {
      cssChunks.push(sm[1]);
    }

    const linkPatterns = [
      /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi,
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/gi,
      /<link[^>]+rel=stylesheet[^>]+href=["']([^"']+)["']/gi,
    ];
    for (const pattern of linkPatterns) {
      let lm: RegExpExecArray | null;
      while ((lm = pattern.exec(html)) !== null) {
        const href = lm[1];
        if (href.startsWith("data:")) continue;
        try {
          const resolved = new URL(href, baseUrl).href;
          if (!sheetUrls.includes(resolved)) sheetUrls.push(resolved);
        } catch { /* ignore unparseable hrefs */ }
      }
    }

    await Promise.allSettled(
      sheetUrls.slice(0, MAX_STYLESHEETS).map(async (sheetUrl) => {
        try {
          validateWebsiteUrl(sheetUrl);
          const res = await fetchWithTimeout(sheetUrl, FETCH_TIMEOUT_MS);
          if (res.ok) {
            const text = await res.text();
            cssChunks.push(text.slice(0, MAX_CSS_BYTES));
          }
        } catch { /* silently skip inaccessible stylesheets */ }
      }),
    );

    const allCss = cssChunks.join("\n");
    const parsed2 = extractCssDesignTokens(allCss);
    cssVariables   = parsed2.variables;
    cssColors      = parsed2.colors;
    cssFonts       = parsed2.fonts;
    cssBorderRadii = parsed2.borderRadii;
    cssFontSizes   = parsed2.fontSizes;
    frameworks     = detectCssFrameworks(html, sheetUrls);
  } else {
    // Playwright succeeded — use its richer computed values
    cssVariables   = pwResult.variables;
    cssColors      = pwResult.colors;
    cssFonts       = pwResult.fonts;
    cssBorderRadii = pwResult.borderRadii;
    cssFontSizes   = pwResult.fontSizes;
    // Framework detection still runs on HTML (no CSS text needed for class scanning)
    frameworks     = detectCssFrameworks(html, sheetUrls);
  }

  // ── 6. Build the generator prompt ────────────────────────────────────────
  const brandName = ogSiteName || pageTitle;
  const lines: string[] = [
    `Generate a design system inspired by the website: ${parsed.href}`,
    `Brand / page title: ${brandName}`,
  ];

  if (pwResult?.success) {
    lines.push(`Extraction method: headless browser (Playwright) — computed styles reflect live rendered page`);
  }

  if (metaDesc) lines.push(`Site description: ${metaDesc}`);

  const brandColors: string[] = [];
  if (metaThemeColor)          brandColors.push(`theme-color meta tag: ${metaThemeColor}`);
  if (manifestThemeColor)      brandColors.push(`manifest theme_color: ${manifestThemeColor}`);
  if (manifestBackgroundColor) brandColors.push(`manifest background_color: ${manifestBackgroundColor}`);
  if (brandColors.length > 0) {
    lines.push(`\nBrand color hints:`);
    for (const c of brandColors) lines.push(`  ${c}`);
  }

  if (frameworks.length > 0) {
    lines.push(`\nCSS framework(s) detected: ${frameworks.join(", ")}`);
    lines.push(`  (Use this framework's standard design language as additional inspiration.)`);
  }

  const varEntries = Object.entries(cssVariables);
  if (varEntries.length > 0) {
    lines.push(`\nCSS custom properties found on the site:`);
    for (const [name, value] of varEntries.slice(0, 60)) {
      lines.push(`  --${name}: ${value}`);
    }
  }

  if (cssColors.length > 0) {
    lines.push(`\nColors used on the site: ${cssColors.slice(0, 20).join(", ")}`);
  }

  if (cssFonts.length > 0) {
    lines.push(`\nFont families used: ${cssFonts.join(", ")}`);
  }

  if (cssFontSizes.length > 0) {
    lines.push(`\nFont sizes found: ${cssFontSizes.join(", ")}`);
  }

  if (cssBorderRadii.length > 0) {
    lines.push(`\nBorder-radius values found: ${cssBorderRadii.join(", ")}`);
  }

  // ── 7. Sparse-CSS fallback instruction ───────────────────────────────────
  const totalSignals = varEntries.length + cssColors.length + cssFonts.length;
  if (totalSignals < MIN_SIGNALS) {
    lines.push(
      `\nNote: Only limited CSS was extractable from this site (it may use CSS-in-JS, ` +
      `a JS framework, or server-side rendering). ` +
      `Based on the brand name "${brandName}", the URL "${parsed.href}", and any color hints above, ` +
      `infer a complete and visually appropriate design system. ` +
      `Choose colors, typography, and component styles that feel authentic to the brand.`,
    );
  } else {
    lines.push(
      "\nUse these design tokens as inspiration to generate a complete, cohesive design system.",
    );
  }

  return lines.join("\n");
}

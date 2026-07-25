const esc = (value) => String(value).replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[character]);

const navItems = [
  ["/", "The story"],
  ["/manual", "Manual"],
  ["/product", "Product"],
  ["/manifesto", "Why 1Helm"],
  ["/docs", "Docs"],
  ["/faq", "FAQ"],
];

function header(path) {
  return `<header class="site-header" data-header>
    <a class="brand" href="/" aria-label="1Helm home">
      <img src="/assets/story/app-icon.png" alt="" width="38" height="38">
      <span>1Helm</span>
    </a>
    <button class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" data-nav-toggle><span></span><span></span></button>
    <nav class="site-nav" aria-label="Main navigation" data-nav>
      ${navItems.map(([href, label]) => `<a href="${href}"${path === href || (href === "/docs" && path.startsWith("/docs/")) ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      <a class="nav-github" href="/github">GitHub <span aria-hidden="true">↗</span></a>
      <a class="nav-download" href="/download/macos">Download</a>
    </nav>
  </header>`;
}

function footer(version) {
  return `<footer class="site-footer">
    <div class="footer-lead"><img src="/assets/story/app-icon.png" alt="" width="52" height="52"><div><strong>1Helm</strong><span>Stop renting intelligence by the session.</span></div></div>
    <div class="footer-grid">
      <div><h2>Product</h2><a href="/product">How it works</a><a href="/manifesto">Manifesto</a><a href="/security">Security</a><a href="/faq">FAQ</a></div>
      <div><h2>Documentation</h2><a href="/docs/getting-started">Getting started</a><a href="/docs/providers-and-routing">Provider fabric</a><a href="/docs/channel-computers">Channel computers</a><a href="/docs/self-hosting">Self-hosting</a></div>
      <div><h2>Install</h2><a href="/docs/install/macos">Apple Silicon Mac</a><a href="/docs/install/linux">Linux & VPS</a><a href="/docs/install/windows-wsl">Windows + WSL</a><a href="/download/macos">Download v${esc(version)}</a></div>
      <div><h2>Project</h2><a href="/github">GitHub</a><a href="https://github.com/gitcommit90/1Helm/releases">Releases</a><a href="https://github.com/gitcommit90/1Helm/issues">Issues</a><a href="/docs/architecture">Architecture</a></div>
    </div>
    <div class="footer-floor"><span>Open source · self-hosted · your machines, your memory, your model fabric.</span><span><a href="mailto:build@1helm.com">build@1helm.com</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · 1Helm v${esc(version)}</span></div>
  </footer>`;
}

export function renderPage(page) {
  const title = page.path === "/" ? "1Helm — Your AI team should outlive the tab" : `${page.title} — 1Helm`;
  const canonical = `https://1helm.com${page.path === "/" ? "" : page.path}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#fdfaf3">
  <meta name="description" content="${esc(page.description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="1Helm">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(page.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="https://1helm.com/assets/story/og-card.png">
  <meta name="twitter:image" content="https://1helm.com/assets/story/og-card.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/assets/story/app-icon.png" type="image/png">
  <link rel="stylesheet" href="/assets/site.css?v=${esc(page.version)}">
  <title>${esc(title)}</title>
</head>
<body class="page-${esc(page.kind || "standard")}">
  <a class="skip-link" href="#content">Skip to content</a>
  <div class="site-shell">
    ${header(page.path)}
    <div id="content">${page.body}</div>
    ${footer(page.version)}
  </div>
  <script src="/assets/site.js?v=${esc(page.version)}" defer></script>
</body>
</html>`;
}

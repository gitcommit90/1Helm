const esc = (value) => String(value).replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[character]);

const navItems = [
  ["/", "the story"],
  ["/manual", "manual"],
  ["/manual#faq", "FAQ"],
];

function header(path) {
  return `<header class="site-header" data-header>
    <a class="brand" href="/" aria-label="1Helm home">
      <img src="/assets/story/app-icon.png" alt="" width="38" height="38">
      <span>1Helm</span>
    </a>
    <button class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" data-nav-toggle><span></span><span></span></button>
    <nav class="site-nav" aria-label="Main navigation" data-nav>
      ${navItems.map(([href, label]) => `<a href="${href}"${path === href || (href === "/manual" && path.startsWith("/manual/")) ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      <a class="nav-github" href="/github">GitHub <span aria-hidden="true">↗</span></a>
      <a class="nav-download" href="/download/macos">Download</a>
    </nav>
  </header>`;
}

function footer(version) {
  return `<footer class="site-footer simple">
    <a href="/">&larr; back to the story</a>
    <span>&middot;</span>
    <a href="/manual">the ship's manual</a>
    <span>&middot;</span>
    <a href="/download/macos">Download 1Helm</a>
    <span>&middot;</span>
    <a href="/github">GitHub &#8599;</a>
    <span>&middot;</span>
    <a href="mailto:build@1helm.com">build@1helm.com</a>
    <span>&middot;</span>
    <a href="/terms">Terms</a>
    <span>&middot;</span>
    <a href="/privacy">Privacy</a>
    <span>&middot;</span>
    <span>1Helm v${esc(version)}</span>
  </footer>`;
}

export function renderPage(page) {
  const title = page.path === "/" ? "1Helm — Your AI team should outlive the tab" : `${page.title} — 1Helm`;
  const canonical = `https://1helm.com${page.path === "/" ? "" : page.path}`;
  const context7Widget = page.path.startsWith("/manual/")
    ? '<script src="https://context7.com/widget.js" data-library="/gitcommit90/1helm"></script>'
    : "";
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
  <link rel="stylesheet" href="/assets/site.css?v=${esc(page.assetVersion || page.version)}">
  <title>${esc(title)}</title>
</head>
<body class="page-${esc(page.kind || "standard")}">
  <a class="skip-link" href="#content">Skip to content</a>
  <div class="site-shell">
    ${header(page.path)}
    <div id="content">${page.body}</div>
    ${footer(page.version)}
  </div>
  <script src="/assets/site.js?v=${esc(page.assetVersion || page.version)}" defer></script>
  ${context7Widget}
</body>
</html>`;
}

#!/usr/bin/env node
/**
 * generate-metrics.js
 *
 * Generates static SVG cards (GitHub stats + top languages) themed to the
 * Neural Terminal palette, so the README never depends on a live third-party
 * image-rendering service (github-readme-stats.vercel.app has been timing
 * out / rate-limiting intermittently).
 *
 * Run via GitHub Actions on a schedule. The output SVGs are committed
 * straight into the repo and referenced from the README with a relative
 * path, so GitHub serves them directly from your repo — no camo proxy hop,
 * no external rate limit, no "Error Fetching Resource".
 *
 * Requires Node 20+ (built-in fetch).
 */

const fs = require("fs");
const path = require("path");

const USERNAME = process.env.GH_USERNAME || "DavidJayaraj01";
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.error("GH_TOKEN env var is required");
  process.exit(1);
}

const COLORS = {
  bg: "#05070a",
  panel: "#0a0f14",
  border: "#5fd8e0",
  cyan: "#5fd8e0",
  green: "#3ddc84",
  amber: "#e0a458",
  text: "#e8f4f5",
  dim: "#7a9499",
};

async function ghGraphQL(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function ghREST(endpoint) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      Authorization: `token ${TOKEN}`,
      Accept: "application/vnd.github+json",
    },
  });
  return res.json();
}

async function getContributionStats() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          totalCommitContributions
          totalPullRequestContributions
          totalIssueContributions
        }
        repositoriesContributedTo(first: 1, contributionTypes: [COMMIT]) {
          totalCount
        }
      }
    }
  `;
  const data = await ghGraphQL(query, { login: USERNAME });
  return data.user;
}

async function getRepoStats() {
  let page = 1;
  let repos = [];
  while (true) {
    const batch = await ghREST(`/users/${USERNAME}/repos?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
  }

  const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);

  // Approximate language mix by primary language per repo (lightweight —
  // avoids an extra API call per repo for exact byte counts).
  const langCounts = {};
  repos.forEach((r) => {
    if (r.language) langCounts[r.language] = (langCounts[r.language] || 0) + 1;
  });

  const langColors = {
    "Jupyter Notebook": "#DA5B0B",
    Python: "#3572A5",
    TypeScript: "#3178C6",
    JavaScript: "#F1E05A",
    HTML: "#E34C26",
    CSS: "#563D7C",
    Java: "#B07219",
    C: "#555555",
    Dart: "#00B4AB",
  };

  const totalLangCount = Object.values(langCounts).reduce((a, b) => a + b, 0);
  const languages = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({
      name,
      pct: totalLangCount ? ((count / totalLangCount) * 100).toFixed(2) : "0.00",
      color: langColors[name] || "#8899a6",
    }));

  return { totalStars, languages };
}

function statsCardSVG({ totalStars, totalCommits, totalPRs, totalIssues, contributedTo }) {
  const rows = [
    ["\u2605", "Total Stars Earned:", totalStars],
    ["\u23F1", "Total Commits (last year):", totalCommits],
    ["\u2942", "Total PRs:", totalPRs],
    ["\u24D8", "Total Issues:", totalIssues],
    ["\u2756", "Contributed to (last year):", contributedTo],
  ];

  const rowsSVG = rows
    .map(
      ([icon, label, value], i) => `
    <text x="24" y="${70 + i * 34}" font-size="14" fill="${COLORS.cyan}" font-family="Fira Code, monospace">${icon}</text>
    <text x="48" y="${70 + i * 34}" font-size="14" fill="${COLORS.text}" font-family="Fira Code, monospace">${label}</text>
    <text x="356" y="${70 + i * 34}" font-size="14" fill="${COLORS.green}" font-family="Fira Code, monospace" text-anchor="end">${value}</text>`
    )
    .join("");

  return `
<svg width="380" height="240" viewBox="0 0 380 240" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="378" height="238" rx="10" fill="${COLORS.panel}" stroke="${COLORS.border}" stroke-opacity="0.35"/>
  <text x="24" y="34" font-size="16" font-weight="bold" fill="${COLORS.cyan}" font-family="Fira Code, monospace">David Jayaraj A — GitHub Stats</text>
  ${rowsSVG}
</svg>`.trim();
}

function languagesCardSVG(languages) {
  let x = 24;
  const barWidth = 332;
  const segments = languages
    .map((l) => {
      const w = (Number(l.pct) / 100) * barWidth;
      const seg = `<rect x="${x}" y="60" width="${w}" height="10" rx="2" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");

  const rowsOfTwo = Math.ceil(languages.length / 2);
  const legend = languages
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = 24 + col * 180;
      const ly = 100 + row * 26;
      return `
    <circle cx="${lx}" cy="${ly - 4}" r="5" fill="${l.color}"/>
    <text x="${lx + 14}" y="${ly}" font-size="13" fill="${COLORS.text}" font-family="Fira Code, monospace">${l.name} ${l.pct}%</text>`;
    })
    .join("");

  const h = 100 + rowsOfTwo * 26 + 20;

  return `
<svg width="380" height="${h}" viewBox="0 0 380 ${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="378" height="${h - 2}" rx="10" fill="${COLORS.panel}" stroke="${COLORS.border}" stroke-opacity="0.35"/>
  <text x="24" y="34" font-size="16" font-weight="bold" fill="${COLORS.cyan}" font-family="Fira Code, monospace">Most Used Languages</text>
  <rect x="24" y="60" width="332" height="10" rx="2" fill="#1a1f26"/>
  ${segments}
  ${legend}
</svg>`.trim();
}

async function main() {
  const [{ totalStars, languages }, contrib] = await Promise.all([
    getRepoStats(),
    getContributionStats(),
  ]);

  const stats = {
    totalStars,
    totalCommits: contrib.contributionsCollection.totalCommitContributions,
    totalPRs: contrib.contributionsCollection.totalPullRequestContributions,
    totalIssues: contrib.contributionsCollection.totalIssueContributions,
    contributedTo: contrib.repositoriesContributedTo.totalCount,
  };

  const outDir = path.join(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "metrics-card.svg"), statsCardSVG(stats));
  fs.writeFileSync(path.join(outDir, "languages-card.svg"), languagesCardSVG(languages));

  console.log("Generated assets/metrics-card.svg and assets/languages-card.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

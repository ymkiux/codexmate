const base = process.env.VITEPRESS_BASE || "/codexmate/";

export default {
  title: "Codex Mate",
  description: "Codex/Claude/OpenClaw configuration and session management toolkit",
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "GitHub", link: "https://github.com/SakuraByteCore/codexmate" }
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "GitHub Pages", link: "/guide/github-pages" }
        ]
      }
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/SakuraByteCore/codexmate" }
    ],
    footer: {
      message: "Released under the Apache-2.0 License.",
      copyright: "Copyright © Codex Mate contributors"
    }
  }
};

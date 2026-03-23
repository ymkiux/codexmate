const base = process.env.VITEPRESS_BASE || "/codexmate/";

export default {
  title: "Codex Mate",
  description: "Codex / Claude / OpenClaw configuration and local session management toolkit",
  base,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "快速开始", link: "/guide/getting-started" },
      { text: "核心工作流", link: "/guide/workflow" },
      { text: "GitHub Pages", link: "/guide/github-pages" },
      { text: "GitHub", link: "https://github.com/SakuraByteCore/codexmate" }
    ],
    sidebar: [
      {
        text: "使用指南",
        items: [
          { text: "快速开始", link: "/guide/getting-started" },
          { text: "核心工作流", link: "/guide/workflow" },
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

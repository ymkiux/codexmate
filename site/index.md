---
layout: false
bodyClass: oi-home
---

<div class="oi-home-page">
  <div class="oi-hexagon-layer" aria-hidden="true">
    <svg class="oi-hexagon-svg" viewBox="0 0 1600 1100" fill="none" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="oi-hex-pattern" width="84" height="72.746" patternUnits="userSpaceOnUse">
          <polygon points="21,1 63,1 83,36.373 63,71.746 21,71.746 1,36.373" stroke="rgba(255,255,255,0.16)" stroke-width="1" fill="transparent"></polygon>
        </pattern>
        <pattern id="oi-hex-pattern-accent" width="168" height="145.492" patternUnits="userSpaceOnUse">
          <polygon class="oi-accent" points="42,2 126,2 166,72.746 126,143.492 42,143.492 2,72.746" stroke="rgba(255,255,255,0.26)" stroke-width="1" fill="rgba(255,255,255,0.06)"></polygon>
        </pattern>
      </defs>
      <rect width="1600" height="1100" fill="url(#oi-hex-pattern)"></rect>
      <rect width="1600" height="1100" fill="url(#oi-hex-pattern-accent)"></rect>
    </svg>
  </div>
  <div class="oi-ambient-layer" aria-hidden="true"></div>
  <div class="oi-vignette-layer" aria-hidden="true"></div>

  <header class="oi-header">
    <a class="oi-skip-link" href="#oi-main">跳转到主要内容</a>
    <div class="oi-shell">
      <div class="oi-header-pill">
        <a class="oi-brand" href="./">Codex Mate</a>
        <div class="oi-header-actions">
          <a class="oi-btn oi-btn-primary" href="./guide/getting-started">快速开始</a>
        </div>
      </div>
    </div>
    <div class="oi-divider"></div>
  </header>

  <main class="oi-main" id="oi-main">
    <section class="oi-hero">
      <h1 class="oi-title">Codex Mate</h1>
      <p class="oi-subtitle">本地优先的 Codex / Claude Code / OpenClaw 配置与会话管理工具。统一管理 Provider、模型与会话数据，减少切换成本。</p>
      <div class="oi-hero-actions">
        <a class="oi-btn oi-btn-primary" href="./guide/getting-started">开始使用</a>
        <a class="oi-btn oi-btn-outline" href="https://github.com/SakuraByteCore/codexmate" target="_blank" rel="noopener">GitHub</a>
      </div>
    </section>

    <section class="oi-section">
      <h2 class="oi-visually-hidden">功能特性</h2>
      <div class="oi-feature-grid">
        <article class="oi-card">
          <div class="oi-card-head">
            <span class="oi-card-icon">P</span>
            <h3 class="oi-card-title">多提供商管理</h3>
          </div>
          <p class="oi-card-desc">统一管理 Codex、Claude Code、OpenClaw 配置，按工具独立维护，避免配置串扰。</p>
        </article>
        <article class="oi-card">
          <div class="oi-card-head">
            <span class="oi-card-icon">M</span>
            <h3 class="oi-card-title">模型快速切换</h3>
          </div>
          <p class="oi-card-desc">提供 Provider 与模型切换入口，支持常见工作流快速切换，不必手动编辑多份配置。</p>
        </article>
        <article class="oi-card">
          <div class="oi-card-head">
            <span class="oi-card-icon">S</span>
            <h3 class="oi-card-title">会话集中管理</h3>
          </div>
          <p class="oi-card-desc">聚合本地会话列表，支持搜索、导出、删除与清理，保留可追溯的历史记录。</p>
        </article>
        <article class="oi-card">
          <div class="oi-card-head">
            <span class="oi-card-icon">B</span>
            <h3 class="oi-card-title">本地优先与备份</h3>
          </div>
          <p class="oi-card-desc">写入前自动备份关键文件，出现误操作可快速回滚，降低配置变更风险。</p>
        </article>
        <article class="oi-card">
          <div class="oi-card-head">
            <span class="oi-card-icon">W</span>
            <h3 class="oi-card-title">Web UI 配合 CLI</h3>
          </div>
          <p class="oi-card-desc">CLI 适合自动化脚本，Web UI 适合可视化管理，二者可并行使用并共享同一套本地数据。</p>
        </article>
      </div>
    </section>

    <section class="oi-workflow">
      <h2>工作流程</h2>
      <div class="oi-flow-list">
        <div class="oi-flow-item">
          <span class="oi-flow-step">1</span>
          <div>
            <p class="oi-flow-title">初始化配置</p>
            <p class="oi-flow-desc">执行 setup 检测现有环境并建立默认配置与备份。</p>
          </div>
        </div>
        <div class="oi-flow-item">
          <span class="oi-flow-step">2</span>
          <div>
            <p class="oi-flow-title">切换 Provider 与模型</p>
            <p class="oi-flow-desc">按任务需要切换目标提供商与模型，配置自动写入对应工具文件。</p>
          </div>
        </div>
        <div class="oi-flow-item">
          <span class="oi-flow-step">3</span>
          <div>
            <p class="oi-flow-title">在 Web UI 管理会话</p>
            <p class="oi-flow-desc">统一查看会话状态，进行筛选、导出与清理，维持可控的本地工作区。</p>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="oi-footer">
    <a href="https://github.com/SakuraByteCore/codexmate" target="_blank" rel="noopener">Codex Mate</a>
    · Local-first configuration and session toolkit
  </footer>
</div>

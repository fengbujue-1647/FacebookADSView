const iconPaths = {
  "area-chart": ["M3 3v18h18", "m19 9-5 5-4-4-3 3"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "menu": ["M4 6h16", "M4 12h16", "M4 18h16"],
  "shield-check": ["M20 13c0 5-3.5 7.5-8 8.5-4.5-1-8-3.5-8-8.5V5l8-3 8 3v8Z", "m9 12 2 2 4-5"]
};

const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const HOME_THEME_KEY = "zai.home.theme";
const HOME_LANGUAGE_KEY = "zai.home.language";
const DEFAULT_LANGUAGE = "zh-CN";
const SUPPORTED_LANGUAGES = ["zh-CN", "zh-TW", "en", "ja"];

const translations = {
  "zh-CN": {
    "meta.title": "智在 AI | 业务 AI 平台",
    "aria.siteNav": "智在 AI 导航",
    "aria.homeLink": "智在 AI 首页",
    "aria.pageNav": "页面导航",
    "aria.conversionPath": "核心转化路径",
    "controls.theme": "主题",
    "controls.light": "浅色",
    "controls.dark": "深色",
    "controls.language": "Language",
    "nav.capabilities": "能力",
    "nav.architecture": "架构",
    "nav.models": "合作",
    "nav.platform": "平台",
    "nav.console": "平台工作台",
    "nav.ads": "FB 广告监控模块",
    "nav.admin": "平台管理",
    "nav.cta": "进入工作台",
    "hero.eyebrow": "Enterprise AI Workflow Consultant",
    "hero.brand": "智在 AI",
    "hero.lede1": "先听真实工作场景，",
    "hero.lede2": "不把问题硬塞进概念里。",
    "hero.note": "智在 AI 从业务现场出发，拆解资料、数据、流程、权限与部署边界，先跑通一个可验证样机，再决定 SaaS、本地化或混合架构。",
    "hero.primaryCta": "进入平台工作台",
    "hero.secondaryCta": "查看交付架构",
    "hero.trust": "交付后一个月内免费稳定运行维护及模块化迭代支持。",
    "pillars.eyebrow": "The 3 Pillars",
    "pillars.title1": "服务逻辑不是卖概念，",
    "pillars.title2": "而是把业务跑通。",
    "pillars.business.label": "看业务",
    "pillars.business.title": "真实场景先于工具形态",
    "pillars.business.body": "访谈、流程梳理、验收指标先行，避免把业务问题包装成泛 AI 叙事。",
    "pillars.tech.label": "懂技术",
    "pillars.tech.title": "明确系统边界和部署约束",
    "pillars.tech.body": "评估 API、数据权限、任务队列、模型调用和本地化部署的可行性。",
    "pillars.partner.label": "陪跑",
    "pillars.partner.title": "从小样机到长期迭代",
    "pillars.partner.body": "先验证一个流程，再扩展资料库、后台、审核、报表和自动化输出。",
    "models.eyebrow": "Collaboration Models",
    "models.title1": "演示优先，",
    "models.title2": "先跑通流程。",
    "models.trial.title": "体验版：流程样机",
    "models.trial.body": "1 个业务流程拆解，1 个可运行 Demo。",
    "models.project.title": "项目版：专属系统",
    "models.project.body": "资料 / 规则库集成，网页后台，SaaS 或本地化部署。",
    "models.longTerm.title": "长期版：AI 改造合伙",
    "models.longTerm.body": "多流程持续迭代，新业务场景快速接入，持续版本维护。",
    "conversion.scene": "选择真实场景",
    "conversion.materials": "提交现有资料",
    "conversion.prototype": "样机跑通验证",
    "conversion.deployment": "确定部署模式",
    "capabilities.eyebrow": "Core Capability Matrix",
    "capabilities.title": "6 大核心能力矩阵",
    "capabilities.knowledge.title": "专属资料库",
    "capabilities.knowledge.body": "将产品资料、FAQ、规章等整理为 AI 可检索的业务知识。",
    "capabilities.monitoring.title": "数据采集监控",
    "capabilities.monitoring.body": "自动爬取竞品、素材、舆情等数据，完成清洗、归档与日报生成。",
    "capabilities.backend.title": "后台服务开发",
    "capabilities.backend.body": "基于 Golang / Java / Python 开发接口、任务队列与稳定业务后台。",
    "capabilities.templates.title": "业务输出模板",
    "capabilities.templates.body": "按客户原有格式自动输出报价单、日报、脚本、邮件等。",
    "capabilities.assistant.title": "内部 AI 助手",
    "capabilities.assistant.body": "接入公司私有规则，辅助员工完成查询、生成、归档与提醒。",
    "capabilities.audit.title": "审核与留痕",
    "capabilities.audit.body": "设定自动发 / 人审规则，记录来源与版本，管控业务风险。",
    "architecture.eyebrow": "The 9-Layer Architecture",
    "architecture.title": "9 层交付架构",
    "architecture.research.title": "需求调研层",
    "architecture.research.body": "业务访谈、流程梳理、验收指标。",
    "architecture.research.boundary": "明确使用者、输入资料、输出结果和验收口径，先把业务问题说清楚。",
    "architecture.assessment.title": "技术评估层",
    "architecture.assessment.body": "系统边界、API 可用性、部署约束。",
    "architecture.assessment.boundary": "判断现有系统、API、数据权限和部署环境是否支持自动化落地。",
    "architecture.governance.title": "数据治理层",
    "architecture.governance.body": "结构化标签、版本管理、权限分级。",
    "architecture.governance.boundary": "统一资料分类、字段结构、版本来源和访问权限，避免知识库越用越乱。",
    "architecture.agent.title": "Agent 编排层",
    "architecture.agent.body": "RAG 检索、任务规划、Prompt 模板。",
    "architecture.agent.boundary": "设计检索、判断、调用工具和人工确认的任务路径，而不是单次问答。",
    "architecture.execution.title": "工程执行层",
    "architecture.execution.body": "<em>[Python]</em> <em>[Golang]</em> <em>[Java]</em> <em>[C++]</em> 多线程、异步队列、异常重试。",
    "architecture.execution.boundary": "把流程拆成可运行任务，处理并发、队列、异常重试和日志追踪。",
    "architecture.quality.title": "质量控制层",
    "architecture.quality.body": "人工复核、审计日志、风控策略。",
    "architecture.quality.boundary": "对关键结果加入复核、审批、留痕和风险控制，保证输出可追责。",
    "architecture.output.title": "业务输出层",
    "architecture.output.body": "报表看板、审批记录、自动化输出。",
    "architecture.output.boundary": "将结果沉淀为报表、审批记录、文档、邮件或后台可操作动作。",
    "architecture.deployment.title": "部署运行层",
    "architecture.deployment.body": "SaaS / 本地化 / 混合架构。",
    "architecture.deployment.boundary": "根据数据敏感度、协作方式和预算选择 SaaS、本地化或混合架构。",
    "architecture.iteration.title": "售后迭代层",
    "architecture.iteration.body": "Bug 修复、规则优化、功能扩展。",
    "architecture.iteration.boundary": "根据真实使用反馈持续修规则、补功能、扩场景，形成长期维护机制。",
    "final.eyebrow": "Start With One Real Scene",
    "final.title": "智在 AI：先跑通流程，再决定部署。",
    "final.cta": "登录并选择模块"
  },
  "zh-TW": {
    "meta.title": "智在 AI | 業務 AI 平台",
    "aria.siteNav": "智在 AI 導覽",
    "aria.homeLink": "智在 AI 首頁",
    "aria.pageNav": "頁面導覽",
    "aria.conversionPath": "核心轉化路徑",
    "controls.theme": "主題",
    "controls.light": "淺色",
    "controls.dark": "深色",
    "controls.language": "語言",
    "nav.capabilities": "能力",
    "nav.architecture": "架構",
    "nav.models": "合作",
    "nav.platform": "平台",
    "nav.console": "平台工作台",
    "nav.ads": "FB 廣告監控模組",
    "nav.admin": "平台管理",
    "nav.cta": "進入工作台",
    "hero.eyebrow": "Enterprise AI Workflow Consultant",
    "hero.brand": "智在 AI",
    "hero.lede1": "先聽真實工作場景，",
    "hero.lede2": "不把問題硬塞進概念裡。",
    "hero.note": "智在 AI 從業務現場出發，拆解資料、數據、流程、權限與部署邊界，先跑通一個可驗證樣機，再決定 SaaS、本地化或混合架構。",
    "hero.primaryCta": "進入平台工作台",
    "hero.secondaryCta": "查看交付架構",
    "hero.trust": "交付後一個月內免費穩定運行維護及模組化迭代支援。",
    "pillars.eyebrow": "The 3 Pillars",
    "pillars.title1": "服務邏輯不是賣概念，",
    "pillars.title2": "而是把業務跑通。",
    "pillars.business.label": "看業務",
    "pillars.business.title": "真實場景先於工具形態",
    "pillars.business.body": "訪談、流程梳理、驗收指標先行，避免把業務問題包裝成泛 AI 敘事。",
    "pillars.tech.label": "懂技術",
    "pillars.tech.title": "明確系統邊界和部署約束",
    "pillars.tech.body": "評估 API、數據權限、任務隊列、模型調用和本地化部署的可行性。",
    "pillars.partner.label": "陪跑",
    "pillars.partner.title": "從小樣機到長期迭代",
    "pillars.partner.body": "先驗證一個流程，再擴展資料庫、後台、審核、報表和自動化輸出。",
    "models.eyebrow": "Collaboration Models",
    "models.title1": "演示優先，",
    "models.title2": "先跑通流程。",
    "models.trial.title": "體驗版：流程樣機",
    "models.trial.body": "1 個業務流程拆解，1 個可運行 Demo。",
    "models.project.title": "專案版：專屬系統",
    "models.project.body": "資料 / 規則庫整合，網頁後台，SaaS 或本地化部署。",
    "models.longTerm.title": "長期版：AI 改造夥伴",
    "models.longTerm.body": "多流程持續迭代，新業務場景快速接入，持續版本維護。",
    "conversion.scene": "選擇真實場景",
    "conversion.materials": "提交現有資料",
    "conversion.prototype": "樣機跑通驗證",
    "conversion.deployment": "確定部署模式",
    "capabilities.eyebrow": "Core Capability Matrix",
    "capabilities.title": "6 大核心能力矩陣",
    "capabilities.knowledge.title": "專屬資料庫",
    "capabilities.knowledge.body": "將產品資料、FAQ、規章等整理為 AI 可檢索的業務知識。",
    "capabilities.monitoring.title": "數據採集監控",
    "capabilities.monitoring.body": "自動爬取競品、素材、輿情等數據，完成清洗、歸檔與日報生成。",
    "capabilities.backend.title": "後台服務開發",
    "capabilities.backend.body": "基於 Golang / Java / Python 開發介面、任務隊列與穩定業務後台。",
    "capabilities.templates.title": "業務輸出模板",
    "capabilities.templates.body": "按客戶原有格式自動輸出報價單、日報、腳本、郵件等。",
    "capabilities.assistant.title": "內部 AI 助手",
    "capabilities.assistant.body": "接入公司私有規則，輔助員工完成查詢、生成、歸檔與提醒。",
    "capabilities.audit.title": "審核與留痕",
    "capabilities.audit.body": "設定自動發 / 人審規則，記錄來源與版本，管控業務風險。",
    "architecture.eyebrow": "The 9-Layer Architecture",
    "architecture.title": "9 層交付架構",
    "architecture.research.title": "需求調研層",
    "architecture.research.body": "業務訪談、流程梳理、驗收指標。",
    "architecture.research.boundary": "明確使用者、輸入資料、輸出結果和驗收口徑，先把業務問題說清楚。",
    "architecture.assessment.title": "技術評估層",
    "architecture.assessment.body": "系統邊界、API 可用性、部署約束。",
    "architecture.assessment.boundary": "判斷現有系統、API、數據權限和部署環境是否支持自動化落地。",
    "architecture.governance.title": "數據治理層",
    "architecture.governance.body": "結構化標籤、版本管理、權限分級。",
    "architecture.governance.boundary": "統一資料分類、欄位結構、版本來源和訪問權限，避免知識庫越用越亂。",
    "architecture.agent.title": "Agent 編排層",
    "architecture.agent.body": "RAG 檢索、任務規劃、Prompt 模板。",
    "architecture.agent.boundary": "設計檢索、判斷、調用工具和人工確認的任務路徑，而不是單次問答。",
    "architecture.execution.title": "工程執行層",
    "architecture.execution.body": "<em>[Python]</em> <em>[Golang]</em> <em>[Java]</em> <em>[C++]</em> 多執行緒、異步隊列、異常重試。",
    "architecture.execution.boundary": "把流程拆成可運行任務，處理並發、隊列、異常重試和日誌追蹤。",
    "architecture.quality.title": "品質控制層",
    "architecture.quality.body": "人工複核、審計日誌、風控策略。",
    "architecture.quality.boundary": "對關鍵結果加入複核、審批、留痕和風險控制，保證輸出可追責。",
    "architecture.output.title": "業務輸出層",
    "architecture.output.body": "報表看板、審批記錄、自動化輸出。",
    "architecture.output.boundary": "將結果沉澱為報表、審批記錄、文檔、郵件或後台可操作動作。",
    "architecture.deployment.title": "部署運行層",
    "architecture.deployment.body": "SaaS / 本地化 / 混合架構。",
    "architecture.deployment.boundary": "根據數據敏感度、協作方式和預算選擇 SaaS、本地化或混合架構。",
    "architecture.iteration.title": "售後迭代層",
    "architecture.iteration.body": "Bug 修復、規則優化、功能擴展。",
    "architecture.iteration.boundary": "根據真實使用反饋持續修規則、補功能、擴場景，形成長期維護機制。",
    "final.eyebrow": "Start With One Real Scene",
    "final.title": "智在 AI：先跑通流程，再決定部署。",
    "final.cta": "登入並選擇模組"
  },
  en: {
    "meta.title": "ZAI | Business AI Platform",
    "aria.siteNav": "ZAI navigation",
    "aria.homeLink": "ZAI home",
    "aria.pageNav": "Page navigation",
    "aria.conversionPath": "Core conversion path",
    "controls.theme": "Theme",
    "controls.light": "Light",
    "controls.dark": "Dark",
    "controls.language": "Language",
    "nav.capabilities": "Capabilities",
    "nav.architecture": "Architecture",
    "nav.models": "Models",
    "nav.platform": "Platform",
    "nav.console": "Platform Console",
    "nav.ads": "FB Ads Monitor",
    "nav.admin": "Platform Admin",
    "nav.cta": "Open Console",
    "hero.eyebrow": "Enterprise AI Workflow Consultant",
    "hero.brand": "ZAI",
    "hero.lede1": "Start with real work scenes,",
    "hero.lede2": "not concepts forced onto the problem.",
    "hero.note": "ZAI starts from the business floor, maps documents, data, workflows, permissions, and deployment boundaries, validates a working prototype first, then decides between SaaS, local deployment, or hybrid architecture.",
    "hero.primaryCta": "Open Platform Console",
    "hero.secondaryCta": "View Delivery Architecture",
    "hero.trust": "One month of free stable operation, maintenance, and modular iteration support after delivery.",
    "pillars.eyebrow": "The 3 Pillars",
    "pillars.title1": "The service logic is not selling concepts,",
    "pillars.title2": "but getting the business running.",
    "pillars.business.label": "Business",
    "pillars.business.title": "Real scenarios before tool shape",
    "pillars.business.body": "Interviews, process mapping, and acceptance metrics come first, avoiding generic AI narratives around business problems.",
    "pillars.tech.label": "Technology",
    "pillars.tech.title": "Clear system boundaries and deployment constraints",
    "pillars.tech.body": "Evaluate APIs, data permissions, task queues, model calls, and the feasibility of local deployment.",
    "pillars.partner.label": "Co-build",
    "pillars.partner.title": "From prototype to long-term iteration",
    "pillars.partner.body": "Validate one workflow first, then expand knowledge bases, backends, review, reports, and automated outputs.",
    "models.eyebrow": "Collaboration Models",
    "models.title1": "Demo first,",
    "models.title2": "validate the workflow first.",
    "models.trial.title": "Trial: Workflow Prototype",
    "models.trial.body": "One business workflow breakdown and one runnable demo.",
    "models.project.title": "Project: Dedicated System",
    "models.project.body": "Document / rule-base integration, web backend, SaaS or local deployment.",
    "models.longTerm.title": "Long-term: AI Transformation Partner",
    "models.longTerm.body": "Continuous multi-workflow iteration, fast onboarding of new scenarios, and ongoing version maintenance.",
    "conversion.scene": "Choose a real scene",
    "conversion.materials": "Submit existing materials",
    "conversion.prototype": "Validate the prototype",
    "conversion.deployment": "Decide deployment mode",
    "capabilities.eyebrow": "Core Capability Matrix",
    "capabilities.title": "6 Core Capability Matrix",
    "capabilities.knowledge.title": "Dedicated Knowledge Base",
    "capabilities.knowledge.body": "Organize product documents, FAQs, and policies into AI-searchable business knowledge.",
    "capabilities.monitoring.title": "Data Collection Monitoring",
    "capabilities.monitoring.body": "Automatically collect competitor, creative, and public-opinion data, then clean, archive, and generate daily reports.",
    "capabilities.backend.title": "Backend Service Development",
    "capabilities.backend.body": "Build APIs, task queues, and stable business backends with Golang / Java / Python.",
    "capabilities.templates.title": "Business Output Templates",
    "capabilities.templates.body": "Automatically output quotations, daily reports, scripts, emails, and more in the customer's existing format.",
    "capabilities.assistant.title": "Internal AI Assistant",
    "capabilities.assistant.body": "Connect private company rules to help teams query, generate, archive, and receive reminders.",
    "capabilities.audit.title": "Review and Traceability",
    "capabilities.audit.body": "Set auto-send / human-review rules, record sources and versions, and control business risk.",
    "architecture.eyebrow": "The 9-Layer Architecture",
    "architecture.title": "9-Layer Delivery Architecture",
    "architecture.research.title": "Requirements Research Layer",
    "architecture.research.body": "Business interviews, process mapping, acceptance metrics.",
    "architecture.research.boundary": "Clarify users, input materials, outputs, and acceptance criteria before defining the business problem.",
    "architecture.assessment.title": "Technical Assessment Layer",
    "architecture.assessment.body": "System boundaries, API availability, deployment constraints.",
    "architecture.assessment.boundary": "Assess whether existing systems, APIs, data permissions, and environments can support automation.",
    "architecture.governance.title": "Data Governance Layer",
    "architecture.governance.body": "Structured tags, version management, permission levels.",
    "architecture.governance.boundary": "Unify material categories, field structures, version sources, and access rights so the knowledge base stays usable.",
    "architecture.agent.title": "Agent Orchestration Layer",
    "architecture.agent.body": "RAG retrieval, task planning, prompt templates.",
    "architecture.agent.boundary": "Design task paths for retrieval, judgment, tool calls, and human confirmation instead of one-off Q&A.",
    "architecture.execution.title": "Engineering Execution Layer",
    "architecture.execution.body": "<em>[Python]</em> <em>[Golang]</em> <em>[Java]</em> <em>[C++]</em> multithreading, async queues, exception retries.",
    "architecture.execution.boundary": "Break workflows into runnable tasks and handle concurrency, queues, retries, and logs.",
    "architecture.quality.title": "Quality Control Layer",
    "architecture.quality.body": "Human review, audit logs, risk-control policies.",
    "architecture.quality.boundary": "Add review, approval, traceability, and risk control to key outputs so results are accountable.",
    "architecture.output.title": "Business Output Layer",
    "architecture.output.body": "Report dashboards, approval records, automated outputs.",
    "architecture.output.boundary": "Turn results into reports, approval records, documents, emails, or actionable backend operations.",
    "architecture.deployment.title": "Deployment Operations Layer",
    "architecture.deployment.body": "SaaS / local deployment / hybrid architecture.",
    "architecture.deployment.boundary": "Choose SaaS, local deployment, or hybrid architecture based on data sensitivity, collaboration, and budget.",
    "architecture.iteration.title": "After-sales Iteration Layer",
    "architecture.iteration.body": "Bug fixes, rule optimization, feature expansion.",
    "architecture.iteration.boundary": "Keep refining rules, filling feature gaps, and expanding scenarios from real usage feedback.",
    "final.eyebrow": "Start With One Real Scene",
    "final.title": "ZAI: Validate the workflow first, then decide deployment.",
    "final.cta": "Log in and choose a module"
  },
  ja: {
    "meta.title": "智在 AI | 業務 AI プラットフォーム",
    "aria.siteNav": "智在 AI ナビゲーション",
    "aria.homeLink": "智在 AI ホーム",
    "aria.pageNav": "ページナビゲーション",
    "aria.conversionPath": "主要な導入ステップ",
    "controls.theme": "テーマ",
    "controls.light": "ライト",
    "controls.dark": "ダーク",
    "controls.language": "言語",
    "nav.capabilities": "機能",
    "nav.architecture": "構成",
    "nav.models": "協業",
    "nav.platform": "プラットフォーム",
    "nav.console": "ワークスペース",
    "nav.ads": "FB 広告監視モジュール",
    "nav.admin": "管理",
    "nav.cta": "ワークスペースへ",
    "hero.eyebrow": "Enterprise AI Workflow Consultant",
    "hero.brand": "智在 AI",
    "hero.lede1": "まず実際の業務現場を聞き、",
    "hero.lede2": "課題を概念に無理に押し込みません。",
    "hero.note": "智在 AI は業務現場から出発し、資料、データ、プロセス、権限、導入境界を分解します。まず検証可能な試作を動かし、その後 SaaS、ローカル導入、またはハイブリッド構成を決めます。",
    "hero.primaryCta": "ワークスペースへ",
    "hero.secondaryCta": "納品アーキテクチャを見る",
    "hero.trust": "納品後 1 か月間、安定運用保守とモジュール単位の改善を無料で支援します。",
    "pillars.eyebrow": "The 3 Pillars",
    "pillars.title1": "サービスの論理は概念を売ることではなく、",
    "pillars.title2": "業務を動く形にすることです。",
    "pillars.business.label": "業務を見る",
    "pillars.business.title": "実際の現場がツール形態に先立つ",
    "pillars.business.body": "ヒアリング、プロセス整理、受入指標を先に置き、業務課題を汎用 AI の物語に包み込みません。",
    "pillars.tech.label": "技術を見る",
    "pillars.tech.title": "システム境界と導入制約を明確化",
    "pillars.tech.body": "API、データ権限、タスクキュー、モデル呼び出し、ローカル導入の実現性を評価します。",
    "pillars.partner.label": "伴走",
    "pillars.partner.title": "小さな試作から長期改善へ",
    "pillars.partner.body": "まず 1 つのプロセスを検証し、ナレッジベース、バックエンド、審査、レポート、自動出力へ拡張します。",
    "models.eyebrow": "Collaboration Models",
    "models.title1": "デモを優先し、",
    "models.title2": "まずプロセスを動かします。",
    "models.trial.title": "体験版：プロセス試作",
    "models.trial.body": "1 つの業務プロセスを分解し、1 つの実行可能な Demo を作ります。",
    "models.project.title": "プロジェクト版：専用システム",
    "models.project.body": "資料 / ルールベース連携、Web 管理画面、SaaS またはローカル導入。",
    "models.longTerm.title": "長期版：AI 改造パートナー",
    "models.longTerm.body": "複数プロセスを継続改善し、新しい業務場面を素早く接続し、継続的に版を維持します。",
    "conversion.scene": "実際の場面を選ぶ",
    "conversion.materials": "既存資料を提出",
    "conversion.prototype": "試作を動かして検証",
    "conversion.deployment": "導入方式を決定",
    "capabilities.eyebrow": "Core Capability Matrix",
    "capabilities.title": "6 つの中核能力マトリクス",
    "capabilities.knowledge.title": "専用ナレッジベース",
    "capabilities.knowledge.body": "製品資料、FAQ、規程などを AI が検索できる業務知識に整理します。",
    "capabilities.monitoring.title": "データ収集監視",
    "capabilities.monitoring.body": "競合、素材、世論などのデータを自動収集し、洗浄、保管、日報生成まで行います。",
    "capabilities.backend.title": "バックエンドサービス開発",
    "capabilities.backend.body": "Golang / Java / Python で API、タスクキュー、安定した業務バックエンドを開発します。",
    "capabilities.templates.title": "業務出力テンプレート",
    "capabilities.templates.body": "顧客の既存形式に合わせて、見積書、日報、脚本、メールなどを自動出力します。",
    "capabilities.assistant.title": "社内 AI アシスタント",
    "capabilities.assistant.body": "会社固有のルールを接続し、検索、生成、保管、リマインドを支援します。",
    "capabilities.audit.title": "審査と追跡",
    "capabilities.audit.body": "自動送信 / 人手審査ルールを設定し、出所とバージョンを記録して業務リスクを管理します。",
    "architecture.eyebrow": "The 9-Layer Architecture",
    "architecture.title": "9 層の納品アーキテクチャ",
    "architecture.research.title": "要件調査層",
    "architecture.research.body": "業務ヒアリング、プロセス整理、受入指標。",
    "architecture.research.boundary": "利用者、入力資料、出力結果、受入基準を明確にし、まず業務課題を言語化します。",
    "architecture.assessment.title": "技術評価層",
    "architecture.assessment.body": "システム境界、API 可用性、導入制約。",
    "architecture.assessment.boundary": "既存システム、API、データ権限、導入環境が自動化に対応できるか判断します。",
    "architecture.governance.title": "データガバナンス層",
    "architecture.governance.body": "構造化タグ、バージョン管理、権限階層。",
    "architecture.governance.boundary": "資料分類、項目構造、版の出所、アクセス権限を統一し、ナレッジベースが乱れないようにします。",
    "architecture.agent.title": "Agent オーケストレーション層",
    "architecture.agent.body": "RAG 検索、タスク計画、Prompt テンプレート。",
    "architecture.agent.boundary": "単発の問答ではなく、検索、判断、ツール呼び出し、人手確認のタスク経路を設計します。",
    "architecture.execution.title": "エンジニアリング実行層",
    "architecture.execution.body": "<em>[Python]</em> <em>[Golang]</em> <em>[Java]</em> <em>[C++]</em> マルチスレッド、非同期キュー、例外リトライ。",
    "architecture.execution.boundary": "プロセスを実行可能なタスクに分解し、並行処理、キュー、例外リトライ、ログ追跡を扱います。",
    "architecture.quality.title": "品質管理層",
    "architecture.quality.body": "人手確認、監査ログ、リスク制御方針。",
    "architecture.quality.boundary": "重要な結果に確認、承認、追跡、リスク制御を加え、出力を追責可能にします。",
    "architecture.output.title": "業務出力層",
    "architecture.output.body": "レポート画面、承認記録、自動化出力。",
    "architecture.output.boundary": "結果をレポート、承認記録、文書、メール、または管理画面で操作可能なアクションに落とし込みます。",
    "architecture.deployment.title": "導入運用層",
    "architecture.deployment.body": "SaaS / ローカル導入 / ハイブリッド構成。",
    "architecture.deployment.boundary": "データ機密性、協働方式、予算に応じて SaaS、ローカル導入、またはハイブリッド構成を選びます。",
    "architecture.iteration.title": "納品後改善層",
    "architecture.iteration.body": "Bug 修正、ルール最適化、機能拡張。",
    "architecture.iteration.boundary": "実際の利用フィードバックからルールを直し、機能を補い、場面を広げて長期保守の仕組みにします。",
    "final.eyebrow": "Start With One Real Scene",
    "final.title": "智在 AI：まずプロセスを動かし、それから導入を決める。",
    "final.cta": "ログインしてモジュールを選択"
  }
};

function getStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function setStoredValue(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Storage can be unavailable in strict browser modes; the visible state still updates.
  }
}

function getTranslation(language, key) {
  return translations[language]?.[key] ?? translations[DEFAULT_LANGUAGE][key] ?? "";
}

function applyTheme(theme, persist = true) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const active = button.dataset.themeChoice === nextTheme;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (persist) {
    setStoredValue(HOME_THEME_KEY, nextTheme);
  }
}

function getInitialTheme() {
  const storedTheme = getStoredValue(HOME_THEME_KEY);
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme;
  }
  const inlineTheme = document.documentElement.dataset.theme;
  return inlineTheme === "dark" ? "dark" : "light";
}

function initThemeControls() {
  applyTheme(getInitialTheme(), false);
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.themeChoice));
  });
}

function getInitialLanguage() {
  const storedLanguage = getStoredValue(HOME_LANGUAGE_KEY);
  if (SUPPORTED_LANGUAGES.includes(storedLanguage)) {
    return storedLanguage;
  }
  const documentLanguage = document.documentElement.lang;
  if (SUPPORTED_LANGUAGES.includes(documentLanguage)) {
    return documentLanguage;
  }
  return DEFAULT_LANGUAGE;
}

function applyLanguage(language, persist = true) {
  const nextLanguage = SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
  document.documentElement.lang = nextLanguage;
  document.title = getTranslation(nextLanguage, "meta.title");

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = getTranslation(nextLanguage, node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((node) => {
    node.innerHTML = getTranslation(nextLanguage, node.dataset.i18nHtml);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", getTranslation(nextLanguage, node.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-boundary]").forEach((node) => {
    node.dataset.boundary = getTranslation(nextLanguage, node.dataset.i18nBoundary);
  });
  document.querySelectorAll("[data-i18n-typewriter]").forEach((node) => {
    const text = getTranslation(nextLanguage, node.dataset.i18nTypewriter);
    const output = node.querySelector("[data-typewriter-output]");
    node.dataset.typewriterText = text;
    node.setAttribute("aria-label", text);
    if (output) {
      output.textContent = text;
    }
    if (node.dataset.typewriterInitialized === "true") {
      window.dispatchEvent(new CustomEvent("zai:languagechange", {
        detail: { typewriterText: text }
      }));
    }
  });

  const select = document.querySelector("[data-language-select]");
  if (select) {
    select.value = nextLanguage;
  }
  if (persist) {
    setStoredValue(HOME_LANGUAGE_KEY, nextLanguage);
  }
}

function initLanguageControls() {
  applyLanguage(getInitialLanguage(), false);
  const select = document.querySelector("[data-language-select]");
  if (!select) return;
  select.addEventListener("change", () => applyLanguage(select.value));
}

function initIcons() {
  document.querySelectorAll("i[data-lucide]").forEach((icon) => {
    const paths = iconPaths[icon.dataset.lucide];
    if (!paths) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    paths.forEach((definition) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", definition);
      svg.appendChild(path);
    });
    icon.replaceChildren(svg);
  });
}

function initHomeNav() {
  const nav = document.querySelector("[data-home-nav]");
  const trigger = nav?.querySelector("[data-home-nav-trigger]");
  if (!nav || !trigger) return;

  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    trigger.setAttribute("aria-expanded", String(open));
  };

  trigger.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
  document.addEventListener("click", (event) => {
    if (nav.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setOpen(false);
    trigger.focus();
  });
}

function initReveal() {
  const nodes = document.querySelectorAll(".reveal");
  if (!nodes.length) return;

  const staggerGroups = [
    ".capability-grid",
    ".model-grid"
  ];

  staggerGroups.forEach((selector) => {
    document.querySelectorAll(`${selector} .reveal`).forEach((node, index) => {
      node.style.setProperty("--reveal-delay", `${Math.min(index * 36, 216)}ms`);
    });
  });

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: "0px 0px -12% 0px",
    threshold: 0.12
  });

  nodes.forEach((node) => observer.observe(node));
}

function initLoader() {
  const loader = document.querySelector("[data-loader]");
  const markReady = () => document.body.classList.add("is-home-ready");
  if (!loader) {
    markReady();
    return;
  }
  const hide = () => {
    loader.classList.add("is-hidden");
    markReady();
  };
  if (prefersReducedMotion) {
    hide();
    return;
  }
  window.setTimeout(hide, 680);
  window.addEventListener("load", hide, { once: true });
}

function initHeroTypewriter() {
  const typewriter = document.querySelector("[data-typewriter]");
  const output = typewriter?.querySelector("[data-typewriter-output]");
  let text = typewriter?.dataset.typewriterText || output?.textContent || "";
  if (!typewriter || !output || !text) return;

  let chars = [];
  let charTimes = [];
  let startedAt = 0;
  let visibleCount = 0;
  let timerId = 0;
  let started = false;
  const startDelayMs = 1320;

  const buildTimeline = () => {
    chars = Array.from(text);
    charTimes = [];
    chars.forEach((_, index) => {
      const previous = index > 0 ? charTimes[index - 1] : 0;
      const pause = "，。、/,.。".includes(chars[index - 1] || "") ? 90 : 0;
      charTimes.push(previous + 32 + pause);
    });
  };

  const clearTimer = () => {
    if (!timerId) return;
    window.clearTimeout(timerId);
    timerId = 0;
  };

  const complete = () => {
    output.textContent = text;
    typewriter.classList.add("is-typewriter-complete");
    clearTimer();
  };

  const restartWithText = (nextText) => {
    text = nextText || typewriter.dataset.typewriterText || "";
    typewriter.dataset.typewriterText = text;
    typewriter.setAttribute("aria-label", text);
    clearTimer();
    buildTimeline();
    visibleCount = chars.length;
    started = true;
    complete();
  };

  typewriter.setAttribute("aria-label", text);
  typewriter.dataset.typewriterInitialized = "true";
  window.addEventListener("zai:languagechange", (event) => {
    restartWithText(event.detail?.typewriterText);
  });

  if (prefersReducedMotion) {
    output.textContent = text;
    typewriter.classList.add("is-typewriter-complete");
    return;
  }
  output.textContent = text;

  buildTimeline();

  const typeNext = () => {
    const elapsed = Date.now() - startedAt;
    while (visibleCount < chars.length && charTimes[visibleCount] <= elapsed) {
      visibleCount += 1;
    }
    output.textContent = chars.slice(0, visibleCount).join("");
    if (visibleCount >= chars.length) {
      complete();
      return;
    }
    timerId = window.setTimeout(typeNext, 32);
  };

  const start = () => {
    if (started) return;
    started = true;
    visibleCount = 0;
    output.textContent = "";
    typewriter.classList.remove("is-typewriter-complete");
    startedAt = Date.now() + startDelayMs;
    timerId = window.setTimeout(typeNext, startDelayMs);
  };

  const rect = typewriter.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
  const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  if (visibleHeight > rect.height * 0.2) {
    start();
    return;
  }

  if (!("IntersectionObserver" in window)) {
    start();
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      start();
      observer.disconnect();
    });
  }, {
    rootMargin: "0px 0px -10% 0px",
    threshold: 0.2
  });

  observer.observe(typewriter);
  window.addEventListener("pagehide", complete, { once: true });
}

function initArchitectureProgress() {
  const section = document.querySelector("#architecture");
  if (!section) return;
  let frameId = 0;

  const update = () => {
    frameId = 0;
    const rect = section.getBoundingClientRect();
    const viewport = window.innerHeight || 1;
    const total = rect.height + viewport * 0.6;
    const raw = (viewport * 0.82 - rect.top) / total;
    const progress = Math.min(1, Math.max(0, raw));
    section.style.setProperty("--arch-progress", progress.toFixed(4));
  };

  const scheduleUpdate = () => {
    if (frameId) return;
    frameId = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
}

initIcons();
initThemeControls();
initLanguageControls();
initHomeNav();
initReveal();
initLoader();
initHeroTypewriter();
initArchitectureProgress();

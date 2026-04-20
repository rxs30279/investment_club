// Prevents prompts from bloating when sources return many records for a large
// portfolio. Data is reference material — completeness matters less than keeping
// the prompt well within DeepSeek's context window.
export function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[... truncated for length — remaining entries omitted ...]';
}

export const STYLE_BLOCK =
  'STYLE: Dark theme. Background #111827, cards #1f2937, border #374151, text #e5e7eb, ' +
  'green #10b981, amber #f59e0b, red #ef4444. Font: Inter (Google Fonts). Cards with rounded corners and subtle shadow. ' +
  'Every top-level section must be wrapped in <div class="section">. ' +
  'Use <details><summary> tags for all expandable sections with summary text "📖 Read more — [topic]" (book emoji, em dash). ' +
  'Traffic light emojis in tables. Output only the HTML. ' +
  'NEVER use markdown syntax in the output — no **bold**, no ##headings, no bullet hyphens. Use HTML tags only (<strong>, <h3>, <ul> etc.).\n\n' +
  'TONE: Friendly knowledgeable friend, not City broker. Plain English. Jargon explained inline. ' +
  'Four threads throughout: (1) large/mid-cap gap (2) M&A landscape (3) macro backdrop (4) ETF flow alignment. Forward views = opinion not advice.';

// Part One of the report: macro big picture, ETF flows, and outlook.
export function buildPart1Message(
  portfolioJSON: string,
  macroJSON: string,
  etfData: string,
  reportMonth: string,
  currentDate: string,
): string {
  const sections = [
    'CONTENTS LIST — Before any sections, render a compact styled dark-theme contents panel. ' +
    'Show two parts clearly:\n' +
    '  PART ONE: MARKET OVERVIEW — 1. The Big Picture  2. ETF Flow Signal  3. Outlook\n' +
    '  PART TWO: CLUB ASSETS & THE MARKET — 4. Press Coverage  5. Portfolio vs Market  6. Sector Scorecard & Theme Tracker  7. Income Corner  8. Results & Corporate Actions  9. One to Watch\n' +
    'Style as a card with two clearly labelled rows. No anchor links needed — plain text is fine.',

    '1. THE BIG PICTURE — Macro tile row (GDP, CPI, GBP/USD, 10yr Gilt, Brent, Gold). 3–4 sentence macro summary. FTSE 100 vs FTSE 250 YTD banner with gap analysis.',

    '2. ETF FLOW SIGNAL — Top 10 ETF themes table (Rank|Theme|Category|YTD|Signal: >40% VERY HOT, 20–40% HOT, 10–20% WARM, <10% COOL). Absent themes. Portfolio alignment table + FLOW ALIGNMENT SCORE badge. Stealth themes note. Dropdown: methodology.',

    '3. OUTLOOK — Month ahead: 3–4 sentences + weather symbol 64px. Year ahead: 4–5 sentences + weather symbol. Dropdown: 3 upside surprises, 3 downside risks, mid-cap case, M&A outlook, ETF flow analogues.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 1 of 4 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (Yahoo Finance prices pre-fetched; other fields use your knowledge):\n' + macroJSON + '\n\n' +
    'ETF FLOW DATA (use below if present, otherwise use your knowledge):\n' + cap(etfData, 6000) + '\n\n' +
    'Use your training knowledge for macro figures not provided above. Use [DATA NEEDED] where genuinely uncertain.\n\n' +
    'OUTPUT: Begin with <div id="monthly-report">. Output the Contents List then sections 1–3 only. ' +
    'Do NOT add a footer or closing </div> — parts 2a, 2b and 3 follow immediately. No preamble. Output only the HTML.\n\n' +
    STYLE_BLOCK + '\n\n' +
    'SECTIONS (write Contents List then all 3 sections):\n\n' + sections
  );
}

// Opens Part Two. Keeping section 4 in its own call (separate from section 5)
// stops DeepSeek from derailing inside the dropdown analysis and then silently
// skipping section 5.
export function buildPart2aMessage(
  portfolioJSON: string,
  macroJSON: string,
  materialData: string,
  pressNews: string,
  userArticles: string,
  reportMonth: string,
  currentDate: string,
): string {
  const memberBlock = userArticles?.trim()
    ? 'MEMBER READING LIST (articles shared by club members — format: [Contributor Name] "Title" then body; feature these prominently in section 4):\n' + userArticles + '\n\n'
    : '';

  const sections = [
    'PART TWO DIVIDER — Before section 4, render a prominent full-width section divider card ' +
    'labelled "PART TWO: CLUB ASSETS & THE MARKET" with a short subtitle "How our holdings relate to current market conditions." ' +
    'Style it as a dark card with an emerald accent border.',

    '4. PRESS COVERAGE — Use the PRESS NEWS data and MEMBER READING LIST below. ' +
    'Table: Date | Ticker | Company | Headline | Source | Impact (Positive / Negative / Neutral). ' +
    'Select the 10–15 most significant stories; prioritise FT and Bloomberg sources. ' +
    'If MEMBER READING LIST articles are present, render them in a separate highlighted card titled "Members\' Reading List" ' +
    'immediately below the main table, with a short 2-sentence note on why each article is relevant to the portfolio. ' +
    'Dropdown: one paragraph analysis per key article explaining what it means for the holding.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 2a of 4 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'MATERIAL RNS (results, trading updates, acquisitions, capital raises, board changes — live AI summaries from Investegate):\n' + cap(materialData, 6000) + '\n\n' +
    'PRESS NEWS (Google News RSS, searched by portfolio company name — use for section 4):\n' + cap(pressNews, 6000) + '\n\n' +
    memberBlock +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output the Part Two divider then section 4 only. Do NOT write section 5 — another call produces it. Do NOT add a footer or closing </div>. No preamble. Output only the HTML.\n\n' +
    STYLE_BLOCK + '\n\n' +
    'SECTIONS (write Part Two divider then section 4):\n\n' + sections
  );
}

// Section 5 isolated into its own call so the detailed HTML structure
// (performance table, amber notice, index cards, stock dropdown) always renders.
export function buildPart2bMessage(
  portfolioJSON: string,
  macroJSON: string,
  unitValueStats: string,
  reportMonth: string,
  currentDate: string,
  perfMonth: string,
  indexMtdWindow: string,
): string {
  const section5 =
    '5. PORTFOLIO vs MARKET — All output must be valid HTML only. Never use markdown.\n\n' +
    'A) PERFORMANCE TABLE — wrap in <div style="margin-bottom:24px">. ' +
    'Rows: MESI Portfolio / FTSE 100 / FTSE 250. Columns: "Month - ' + perfMonth + '" / YTD. ' +
    'Under the Month column header render a <div style="font-size:11px;color:#6b7280;font-weight:normal;margin-top:2px"> showing the date window from FUND PERFORMANCE. ' +
    'MESI row uses monthly_return_pct and ytd_return_pct from FUND PERFORMANCE. FTSE rows use MACRO figures.\n\n' +
    'B) AMBER NOTICE — immediately after the table render: <div class="notice-amber">One sentence on the unit-value lag. One sentence pointing to the Holdings page.</div>\n\n' +
    'C) INDEX BREAKDOWN — render <h3>Index Membership Breakdown</h3> then immediately below it render a <p style="font-size:12px;color:#6b7280;margin-bottom:16px"> containing the exact text "Month to date: ' + indexMtdWindow + '" so readers see the window these per-stock figures cover (sourced from PORTFOLIO monthly_change_pct, which is measured from the 1st of the current calendar month to today — NOT the fund-performance window used in the table above). Then one short intro sentence in a <p>.\n' +
    'Then for each index group (FTSE 100 / FTSE 250 / AIM / other) render one card using EXACTLY this class structure:\n' +
    '<div class="index-card">\n' +
    '  <div class="index-card-header">\n' +
    '    <span class="index-card-title">FTSE 100</span>\n' +
    '    <span class="index-card-badge">4 holdings</span>\n' +
    '  </div>\n' +
    '  <div class="index-card-pct pct-pos">+10.2%</div>\n' +
    '  <div class="index-card-label">Avg. monthly change</div>\n' +
    '  <div class="index-card-holdings">BAE Systems, Rolls-Royce, RELX, Lloyds</div>\n' +
    '  <div class="index-card-note">One sentence on what drove this group and any outliers.</div>\n' +
    '</div>\n' +
    'Use class "pct-pos" for positive, "pct-neg" for negative. Cards stacked vertically. Do not use a flex row.\n\n' +
    'D) DROPDOWN — <details> with stock-by-stock contribution table (Ticker | Company | Monthly Change | Contribution | Notes), sorted best to worst.';

  return (
    'Today is ' + currentDate + '. You are writing PART 2b of 4 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO:\n' + portfolioJSON + '\n\n' +
    'FUND PERFORMANCE:\n' + unitValueStats + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output section 5 only (no Part Two divider — a sibling call handles that; no section 4 — another call handles it). ' +
    'Begin directly with <div class="section"><h3>5. Portfolio vs Market</h3>. Do NOT add a footer or closing </div> for #monthly-report. No preamble. Output only the HTML.\n\n' +
    STYLE_BLOCK + '\n\n' +
    'SECTION (write section 5 only):\n\n' + section5
  );
}

// Closes the report. Merged Sector Scorecard & Theme Tracker, Income Corner,
// Director Dealings, One to Watch. Closes the report div.
export function buildPart3Message(
  portfolioJSON: string,
  macroJSON: string,
  etfData: string,
  rnsData: string,
  materialData: string,
  dividendData: string,
  directorData: string,
  reportMonth: string,
  currentDate: string,
): string {
  const sections = [
    '6. SECTOR SCORECARD & THEME TRACKER — Merged section combining sector performance with theme analysis. ' +
    'Backward table (Sector|Holdings|Market move|Our move|ETF Flow). FTSE100 vs FTSE250 deep dive. ' +
    'Forward compass (Sector|View|Rationale|ETF Signal|Key Risk). ' +
    'Then a Theme table: Theme|Direction|Strength|ETF Signal|Portfolio Impact — cover: Energy, Gold/Metals, Nuclear, M&A, Dividends, BOE Rates, Defence, Rare Earths, Activism, Labour Risk, AI, Foreign Buyers, Sterling, Clean Energy. ' +
    'Dropdown: bull/bear case 3 points each per sector, and detail on each theme.',

    '7. INCOME CORNER — Use the DIVIDEND DATA provided (ex-div dates + amounts from Yahoo Finance, last 12 months per holding). ' +
    'Table: Ticker | Company | Ex-Div Date | Amount (p) | Annual Yield est. | Vs FTSE100 avg. ' +
    'Copy Ticker, Company, Ex-Div Date and Amount directly from the DIVIDEND DATA block. Sort by Ex-Div Date descending (most recent first). Do NOT include a Payment Date column — payment dates are not in the data. ' +
    'Annual Yield est. and Vs FTSE100 avg. — compute from your own knowledge of the holding (typical annual dividend per share ÷ current price) vs FTSE100 ~3.5% dividend yield / ~6.5% total cash yield. ' +
    'Call out dividends paid recently, any cuts or increases vs prior year, and buybacks you are aware of. ' +
    'Dropdown: dividend history per holding.',

    '8. RESULTS & CORPORATE ACTIONS — Two sub-sections in one card.\n' +
    'Sub-section A — Results & Corporate Actions: Use the MATERIAL RNS DATA provided. ' +
    'For each item: Ticker | Company | Category | Date | Key numbers from summary | Verdict (Beat/In-line/Miss/Transformative). ' +
    'Group by category. Dropdown: full summary per item. If no material announcements, say so.\n' +
    'Sub-section B — Director Dealings: Use the DIRECTOR DEALINGS DATA provided (live from Investegate). ' +
    'Table: Date | Ticker | Company | Director/Role | Buy/Sell | Shares | Price (p) | Value £ | Signal. ' +
    'If no dealings say so clearly. Interpret sentiment: buying = bullish insider signal, selling = neutral unless large % of holding. ' +
    'Dropdown: context on each dealing.',

    '9. ONE TO WATCH — One holding needing attention next month. 3–4 sentences. Index, theme, ETF flow context.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 3 of 4 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'ETF FLOW DATA (use for sector/theme analysis in section 6):\n' + cap(etfData, 4000) + '\n\n' +
    'RNS INDEX (all portfolio announcements, last 60 trading days — reference for sector/theme context):\n' + cap(rnsData, 2000) + '\n\n' +
    'MATERIAL RNS (results, trading updates, acquisitions, capital raises, board changes — PRIMARY SOURCE for section 8 Results & Corporate Actions, also reference for sector context):\n' + cap(materialData, 8000) + '\n\n' +
    'DIVIDEND DATA (live ex-dividend dates and amounts from Yahoo Finance — last 12 months per holding):\n' + cap(dividendData, 4000) + '\n\n' +
    'DIRECTOR DEALINGS (live from Investegate — last 60 trading days, portfolio holdings only, with AI summaries):\n' + cap(directorData, 5000) + '\n\n' +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output sections 6–9 only, then the footer paragraph, then close with </div>. No preamble. Output only the HTML.\n\n' +
    STYLE_BLOCK + '\n\n' +
    'FOOTER (after section 9): Before the footer text, render a full-width <hr> styled with border-color #374151 and margin 32px 0. Then render the footer as a small centered paragraph in text color #6b7280. Text: Report generated ' + currentDate +
    ' | Portfolio data: Club database | Market data: Investegate, Yahoo Finance UK, Bank of England, ONS' +
    ' | ETF flow data: JustETF (justetf.com/uk) | RNS, Results & Director Dealings: Investegate' +
    ' | Press coverage: Google News | This report is produced for club members only and does not constitute financial advice.\n\n' +
    'SECTIONS (write all 4, then footer, then </div>):\n\n' + sections
  );
}

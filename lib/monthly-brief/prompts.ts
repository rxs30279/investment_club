// Prevents prompts from bloating when sources return many records for a large
// portfolio. Data is reference material — completeness matters less than keeping
// the prompt well within DeepSeek's context window.
export function cap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n[... truncated for length — remaining entries omitted ...]';
}

// Shared rules for every call. Lives in the system prompt so each user message
// can focus on what's unique to its sections. Saves ~700 chars per call.
export const SYSTEM_PROMPT =
  'You are a friendly but knowledgeable investment analyst writing a monthly performance report for a UK private investment club. ' +
  'Your tone is warm, engaging and accessible — think a knowledgeable friend explaining markets over a coffee, not a stuffy City broker. ' +
  'Use plain English. Explain jargon where used. Reserve detailed analysis for expandable drop-down sections so the page stays clean and readable. ' +
  'Where you express a forward view, be clear it is opinion not advice.\n\n' +
  'STYLE: Dark theme. Background #111827, cards #1f2937, border #374151, text #e5e7eb, ' +
  'green #10b981, amber #f59e0b, red #ef4444. Font: Inter (Google Fonts). Cards with rounded corners and subtle shadow. ' +
  'Every top-level section must be wrapped in <div class="section">. ' +
  'Use <details><summary> tags for all expandable sections with summary text "📖 Read more — [topic]" (book emoji, em dash). ' +
  'Traffic light emojis in tables.\n\n' +
  'OUTPUT FORMAT: Output only HTML — never markdown. No **bold** (use <strong>), no ##headings (use <h2>/<h3>), no bullet hyphens (use <ul><li>). No preamble, no closing remarks, no code fences.\n\n' +
  'FOUR THREADS to weave through analysis where relevant: (1) large/mid-cap gap (2) M&A landscape (3) macro backdrop (4) ETF flow alignment.';

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
    '  PART TWO: CLUB ASSETS & THE MARKET — 4. Press Coverage  5. Portfolio vs Market  6. Sector Scorecard  7. Results & Corporate Actions  8. Director Dealings  9. One to Watch\n' +
    'Style as a card with two clearly labelled rows. No anchor links needed — plain text is fine.',

    '1. THE BIG PICTURE — Macro tile row (GDP, CPI, GBP/USD, 10yr Gilt, Brent, Gold). 3–4 sentence macro summary.',

    '2. ETF FLOW SIGNAL — Top 10 ETF themes table (Rank|Theme|Category|YTD|Signal: >40% VERY HOT, 20–40% HOT, 10–20% WARM, <10% COOL). Absent themes. Stealth themes note. Dropdown: methodology.',

    '3. OUTLOOK — A single "Month Ahead" card only (no Year Ahead). ' +
    'Use this exact structure (do NOT use display:flex or display:grid — emoji must sit ABOVE the heading, not beside it):\n' +
    '<div class="section" style="background:#1f2937; border:1px solid #374151; border-radius:8px; padding:16px 20px; margin-bottom:16px;">\n' +
    '  <div style="font-size:48px; line-height:1; margin-bottom:8px;">⛅</div>\n' +
    '  <h3 style="margin:0 0 8px 0;">Month Ahead — June 2026</h3>\n' +
    '  <p style="margin:0;">3–4 sentences here.</p>\n' +
    '</div>\n' +
    'Dropdown (KEEP CONCISE — two sentences max per item): 2 upside surprises and 2 downside risks for the month ahead.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 1 of 6 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (Yahoo Finance prices pre-fetched; other fields use your knowledge):\n' + macroJSON + '\n\n' +
    'ETF FLOW DATA (use below if present, otherwise use your knowledge):\n' + cap(etfData, 6000) + '\n\n' +
    'Use your training knowledge for macro figures not provided above. Use [DATA NEEDED] where genuinely uncertain.\n\n' +
    'OUTPUT: Begin with <div id="monthly-report">. Output the Contents List then sections 1–3 only. ' +
    'Do NOT add a footer or closing </div> for #monthly-report — later parts follow immediately. ' +
    'CRITICAL: Every <details>, <ul>, <ol>, <table>, <section> and other container tag you open MUST have its matching close tag before your output ends. ' +
    'An unclosed <details> will swallow every later part of the report into a collapsed dropdown.\n\n' +
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
  // Articles are still passed as background context the model may draw on when
  // discussing the portfolio, but they are NOT rendered as a separate card —
  // members can read them on the /monthly-brief page directly.
  const memberBlock = userArticles?.trim()
    ? 'MEMBER READING LIST (background context only — articles shared by club members. Do NOT render these as a list, card, table, dropdown, or any other visible block in the report. Use them silently to inform your analysis of themes and holdings where directly relevant):\n' + userArticles + '\n\n'
    : '';

  const sections = [
    'PART TWO DIVIDER — Before section 4, render a prominent full-width section divider card ' +
    'labelled "PART TWO: CLUB ASSETS & THE MARKET" with a short subtitle "How our holdings relate to current market conditions." ' +
    'Style it as a dark card with an emerald accent border.',

    '4. PRESS COVERAGE — Use the PRESS NEWS data below. ' +
    'Table: Date | Ticker | Company | Headline | Source | Impact (Positive / Negative / Neutral). ' +
    'CRITICAL: every <tr> MUST contain exactly 6 <td> cells in this order. Never omit a cell, never merge with colspan. ' +
    'If a value is unknown (e.g. company name not in PORTFOLIO), still include the cell with a sensible value (e.g. the ticker without ".L") — never leave it blank or drop the <td>. ' +
    'Select the 10–15 most significant stories; prioritise FT and Bloomberg sources. ' +
    'For the Impact cell, render exactly: <td class="nowrap" style="text-align:center">🟢 Positive</td> (or 🟡 Neutral / 🔴 Negative). The class="nowrap" is REQUIRED — without it the emoji and label wrap onto two lines and overflow the cell. ' +
    'Dropdown: one paragraph analysis per key story explaining what it means for the holding.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 2a of 6 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'MATERIAL RNS (results, trading updates, acquisitions, capital raises, board changes — live AI summaries from Investegate):\n' + cap(materialData, 6000) + '\n\n' +
    'PRESS NEWS (Google News RSS, searched by portfolio company name — use for section 4):\n' + cap(pressNews, 6000) + '\n\n' +
    memberBlock +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output the Part Two divider then section 4 only. Do NOT write section 5 — another call produces it. Do NOT add a footer or closing </div> for #monthly-report. ' +
    'CRITICAL: Every <details>, <ul>, <ol>, <table> you open MUST be closed before your output ends.\n\n' +
    'SECTIONS (write Part Two divider then section 4):\n\n' + sections
  );
}

// Section 5 isolated into its own call so the detailed HTML structure
// (performance table, amber notice, index cards, stock dropdown) always renders.
// Index breakdown is now pre-aggregated server-side — the model just writes prose.
export function buildPart2bMessage(
  portfolioJSON: string,
  macroJSON: string,
  unitValueStats: string,
  indexBreakdownJSON: string,
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
    'C) INDEX BREAKDOWN — render <h3>Index Membership Breakdown</h3> then immediately below it render a <p style="font-size:12px;color:#6b7280;margin-bottom:16px"> containing the exact text "Last 30 days: ' + indexMtdWindow + '" so readers see the window these per-stock figures cover (sourced from PORTFOLIO monthly_change_pct, which is measured over the trailing 30 days — NOT the fund-performance window used in the table above). Then one short intro sentence in a <p>.\n' +
    'Use the INDEX BREAKDOWN JSON below — values are pre-aggregated server-side. For each group render one card using EXACTLY this class structure:\n' +
    '<div class="index-card">\n' +
    '  <div class="index-card-header">\n' +
    '    <span class="index-card-title">FTSE 100</span>\n' +
    '    <span class="index-card-badge">4 holdings · 38.2% of portfolio</span>\n' +
    '  </div>\n' +
    '  <div class="index-card-pct pct-pos">+10.2%</div>\n' +
    '  <div class="index-card-label">Avg. 30-day change (value-weighted)</div>\n' +
    '  <div class="index-card-holdings">BAE Systems, Rolls-Royce, RELX, Lloyds</div>\n' +
    '  <div class="index-card-note">One sentence on what drove this group and any outliers.</div>\n' +
    '</div>\n' +
    'Use class "pct-pos" for positive avgMonthly, "pct-neg" for negative. Cards stacked vertically. Do not use a flex row. The numbers in the card MUST match the JSON (holdingCount, weighting, avgMonthly, companies) — your only job is the note sentence.\n\n' +
    'D) DROPDOWN — <details> with stock-by-stock contribution table (Ticker | Company | 30-Day Change | Contribution | Notes), sorted best to worst.';

  return (
    'Today is ' + currentDate + '. You are writing PART 2b of 6 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO:\n' + portfolioJSON + '\n\n' +
    'FUND PERFORMANCE:\n' + unitValueStats + '\n\n' +
    'INDEX BREAKDOWN (pre-aggregated — render directly into the cards):\n' + indexBreakdownJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output section 5 only (no Part Two divider — a sibling call handles that; no section 4 — another call handles it). ' +
    'Begin directly with <div class="section"><h3>5. Portfolio vs Market</h3>. Do NOT add a footer or closing </div> for #monthly-report. ' +
    'CRITICAL: Every <details>, <ul>, <ol>, <table> you open MUST be closed before your output ends.\n\n' +
    'SECTION (write section 5 only):\n\n' + section5
  );
}

// Section 6 (Sector Scorecard & Theme Tracker). On its own because it's the
// heaviest single section (backward + forward tables + theme table + dropdowns).
export function buildPart3aMessage(
  portfolioJSON: string,
  macroJSON: string,
  etfData: string,
  rnsData: string,
  reportMonth: string,
  currentDate: string,
): string {
  const section6 =
    '6. SECTOR SCORECARD — Keep this SIMPLE: a single sector table and nothing else. ' +
    'Do NOT include a forward compass, an FTSE100 vs FTSE250 deep dive, a separate theme tracker table, or a bull/bear dropdown. ' +
    'One short intro sentence, then ONE table with these columns: Sector | Our Holdings | Our Move (last 30 days) | Outlook. ' +
    'One row per sector the club holds, sorted by Our Move best to worst. ' +
    'Use a traffic-light emoji in the Our Move cell (🟢 up / 🟡 flat / 🔴 down). ' +
    'The Outlook cell is a single short phrase (e.g. "Positive", "Watch", "Cautious") plus at most a half-sentence why. ' +
    'No padding, no extra prose after the table.';

  return (
    'Today is ' + currentDate + '. You are writing PART 3a of 6 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'ETF FLOW DATA (use for sector/theme analysis):\n' + cap(etfData, 4000) + '\n\n' +
    'RNS INDEX SUMMARY (announcement counts per ticker — reference only):\n' + cap(rnsData, 1500) + '\n\n' +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output section 6 only. Do NOT add a footer or closing </div> for #monthly-report — later parts follow. ' +
    'CRITICAL: Every <details>, <ul>, <ol>, <table> you open MUST be closed before your output ends.\n\n' +
    'SECTION (write section 6 only):\n\n' + section6
  );
}

// Section 7 (Results & Corporate Actions). Income Corner used to live here too,
// but it now has its own page (/income) driven by live Yahoo data.
export function buildPart3bMessage(
  portfolioJSON: string,
  macroJSON: string,
  materialData: string,
  reportMonth: string,
  currentDate: string,
): string {
  const sections = [
    '7. RESULTS & CORPORATE ACTIONS — Use ONLY the MATERIAL RNS DATA provided. Do NOT add items from your training knowledge, do NOT recall past announcements, and do NOT supplement. If the data is short, the table is short. ' +
    'For each item: Ticker | Company | Category | Date | Key numbers from summary | Verdict (Beat/In-line/Miss/Transformative). ' +
    'For the Verdict cell, wrap just the emoji + verdict word in a nowrap span so they cannot split across lines: <td><span class="nowrap">🟢 Beat</span> — growth story intact</td>. The descriptive part after the em-dash may wrap. ' +
    'Group by category. Aggregated rows (headline contains "× ... announcements") describe a recurring programme — render them as one row each, do NOT split them back out. ' +
    'For the Shareholder Changes category specifically, include ONLY strong, material signals — a new substantial holder crossing a major threshold (3% / 5% / 10%), a sizeable stake increase, or a full exit. ' +
    'OMIT routine or minor TR-1 notifications and small threshold crossings. If nothing is material, drop the Shareholder Changes group entirely. ' +
    'Dropdown: full summary per item (only items with a summary in the data). If no material announcements, say so explicitly.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 3b of 6 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'MATERIAL RNS (PRIMARY SOURCE for section 7 Results & Corporate Actions):\n' + cap(materialData, 8000) + '\n\n' +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output section 7 only. Do NOT add a footer or closing </div> for #monthly-report — part 3c follows. ' +
    'CRITICAL: Every <details>, <ul>, <ol>, <table> you open MUST be closed before your output ends.\n\n' +
    'SECTION (write section 7 only):\n\n' + sections
  );
}

// Closes the report: Director Dealings + One to Watch + footer + closing </div>.
export function buildPart3cMessage(
  portfolioJSON: string,
  macroJSON: string,
  directorData: string,
  reportMonth: string,
  currentDate: string,
): string {
  const sections = [
    '8. DIRECTOR DEALINGS — Use the DIRECTOR DEALINGS DATA provided (live from Investegate). ' +
    'Include ONLY strong signals: material insider BUYS, or SELLS that are large as a percentage of the holding or made by a senior director (CEO / CFO / Chair). ' +
    'OMIT small or routine dealings — option/award exercises, scrip-dividend take-ups, and trivial admin trades. ' +
    'Table: Date | Ticker | Company | Director/Role | Buy/Sell | Shares | Price (p) | Value £ | Signal. ' +
    'For the Buy/Sell cell use class="nowrap" on the <td> (short content). For the Signal cell wrap just the emoji + signal word in a nowrap span, leaving descriptive text free to wrap: <td><span class="nowrap">🟢 Bullish</span> — large insider buy</td>. ' +
    'If no strong dealings, say so clearly. Interpret sentiment: buying = bullish insider signal, selling = neutral unless large % of holding. ' +
    'Dropdown: context on each dealing.',

    '9. ONE TO WATCH — One holding needing attention next month. 3–4 sentences. Index, theme, ETF flow context.',
  ].join('\n\n');

  return (
    'Today is ' + currentDate + '. You are writing PART 3c of 6 of the MESI Investment Club Monthly Intelligence Briefing for ' + reportMonth + '.\n\n' +
    'PORTFOLIO (for context):\n' + portfolioJSON + '\n\n' +
    'MACRO (for context):\n' + macroJSON + '\n\n' +
    'DIRECTOR DEALINGS (live from Investegate — last 60 trading days, portfolio holdings only, with AI summaries):\n' + cap(directorData, 5000) + '\n\n' +
    'For all live data above use it directly — do not substitute training knowledge where live data is present.\n\n' +
    'OUTPUT: This is a continuation — do NOT start a new <div id="monthly-report"> or repeat any earlier sections. ' +
    'Output sections 8 and 9, then the footer paragraph, then close with </div>.\n\n' +
    'FOOTER (after section 9): Before the footer text, render a full-width <hr> styled with border-color #374151 and margin 32px 0. Then render the footer as a small centered paragraph in text color #6b7280. Text: Report generated ' + currentDate +
    ' | Portfolio data: Club database | Market data: Investegate, Yahoo Finance UK, Bank of England, ONS' +
    ' | ETF flow data: JustETF (justetf.com/uk) | RNS, Results & Director Dealings: Investegate' +
    ' | Press coverage: Google News | This report is produced for club members only and does not constitute financial advice.\n\n' +
    'SECTIONS (write both, then footer, then </div>):\n\n' + sections
  );
}

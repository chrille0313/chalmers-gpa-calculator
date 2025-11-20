(() => {
  type SkipReason = 'passFail' | 'missingCredits' | 'missingGrade';

  interface SkipSummary {
    reason: SkipReason;
    count: number;
    examples: string[];
  }

  interface StatsPayload {
    averages: {
      weighted: number | null;
      simple: number | null;
    };
    counters: {
      includedCourses: number;
      includedCredits: number;
      totalCourses: number;
      totalCredits: number;
    };
    skipped: SkipSummary[];
    timestamp: number;
  }

  interface PanelRefs {
    panel: HTMLElement;
    status: HTMLElement;
    weighted: HTMLElement;
    simple: HTMLElement;
    includedCourses: HTMLElement;
    includedCredits: HTMLElement;
    totalCourses: HTMLElement;
    totalCredits: HTMLElement;
    skippedList: HTMLElement;
    timestamp: HTMLElement;
  }

  const PANEL_ID = 'chalmers-gpa-panel';
  const PANEL_STYLE_ID = 'chalmers-gpa-panel-style';
  const GET_STATS_MESSAGE = 'chalmers-gpa/get-stats';
  const PANEL_STYLES = `
    #${PANEL_ID} {
      font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      background: rgba(255, 255, 255, 0.98);
      border-radius: 14px;
      border: 1px solid rgba(7, 21, 42, 0.08);
      padding: 20px 22px;
      color: #07152a;
      box-shadow: 0 10px 30px rgba(3, 37, 65, 0.12);
      max-width: 720px;
      width: min(720px, calc(100% - 32px));
      margin: 0 auto 24px;
    }

    #${PANEL_ID} * {
      box-sizing: border-box;
    }

    #${PANEL_ID} .panel-header {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 12px;
    }

    #${PANEL_ID} .panel-title {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 600;
    }

    #${PANEL_ID} .panel-status {
      margin: 0;
      font-size: 0.9rem;
      color: #51607a;
    }

    #${PANEL_ID} .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }

    #${PANEL_ID} .metric {
      background: #f4f7fb;
      border-radius: 10px;
      padding: 12px;
    }

    #${PANEL_ID} .metric-label {
      margin: 0;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #51607a;
    }

    #${PANEL_ID} .metric-value {
      margin: 6px 0 0;
      font-size: 1.6rem;
      font-weight: 600;
      color: #08223f;
    }

    #${PANEL_ID} .counts {
      margin: 0 0 12px;
      font-size: 0.95rem;
      line-height: 1.4;
    }

    #${PANEL_ID} .skipped {
      background: #f9fbff;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.85rem;
      color: #4c5c75;
    }

    #${PANEL_ID} .skipped ul {
      margin: 6px 0 0;
      padding-left: 18px;
    }

    #${PANEL_ID} .timestamp {
      margin: 12px 0 0;
      font-size: 0.75rem;
      color: #52637c;
    }

    @media (prefers-color-scheme: dark) {
      #${PANEL_ID} {
        background: rgba(11, 18, 33, 0.98);
        border-color: #1c2838;
        color: #f2f6ff;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
      }

      #${PANEL_ID} .metric {
        background: #162132;
      }

      #${PANEL_ID} .metric-value {
        color: #e6f0ff;
      }

      #${PANEL_ID} .panel-status,
      #${PANEL_ID} .counts,
      #${PANEL_ID} .skipped,
      #${PANEL_ID} .timestamp {
        color: #c2cad7;
      }
    }
  `;

  const SKIP_REASON_COPY: Record<SkipReason, string> = {
    passFail: 'Pass/fail grade (ignored)',
    missingCredits: 'Missing credits',
    missingGrade: 'Missing or unsupported grade'
  };

  const intlAverage = new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const intlCredits = new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  let panelRefs: PanelRefs | null = null;
  let latestStats: StatsPayload | null = null;
  let attachedTable: HTMLTableElement | null = null;
  let tableObserver: MutationObserver | null = null;
  let tableLocator: MutationObserver | null = null;
  let scheduledUpdate: number | null = null;

  init();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === GET_STATS_MESSAGE) {
      sendResponse({
        stats: latestStats,
        hasTable: Boolean(attachedTable)
      });
      return true;
    }
    return undefined;
  });

  function init(): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
      bootstrap();
    }
  }

  function bootstrap(): void {
    injectPanelStyles();
    panelRefs = ensurePanel();
    updatePanel(null, 'Waiting for transcript…');
    attachToTable();
    if (!attachedTable) {
      waitForTable();
    }
  }

  function injectPanelStyles(): void {
    if (document.getElementById(PANEL_STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = PANEL_STYLE_ID;
    style.textContent = PANEL_STYLES;
    document.head.append(style);
  }

  function ensurePanel(): PanelRefs {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = PANEL_ID;
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-live', 'polite');
      panel.innerHTML = `
        <div class="panel-header">
          <p class="panel-title">Chalmers GPA</p>
          <p class="panel-status" data-field="status">Preparing…</p>
        </div>
        <div class="metrics">
          <div class="metric">
            <p class="metric-label">Weighted average</p>
            <p class="metric-value" data-field="weighted">-</p>
          </div>
          <div class="metric">
            <p class="metric-label">Simple average</p>
            <p class="metric-value" data-field="simple">-</p>
          </div>
        </div>
        <div class="counts">
          <p><strong>Included:</strong> <span data-field="includedCourses">0</span> courses / <span data-field="includedCredits">0</span> hp</p>
          <p><strong>Total:</strong> <span data-field="totalCourses">0</span> courses / <span data-field="totalCredits">0</span> hp</p>
        </div>
        <div class="skipped">
          <p>Excluded rows:</p>
          <ul data-field="skippedList">
            <li>No rows excluded yet.</li>
          </ul>
        </div>
        <p class="timestamp" data-field="timestamp"></p>
      `;
      document.body.prepend(panel);
    }

    return {
      panel,
      status: queryField(panel, 'status'),
      weighted: queryField(panel, 'weighted'),
      simple: queryField(panel, 'simple'),
      includedCourses: queryField(panel, 'includedCourses'),
      includedCredits: queryField(panel, 'includedCredits'),
      totalCourses: queryField(panel, 'totalCourses'),
      totalCredits: queryField(panel, 'totalCredits'),
      skippedList: queryField(panel, 'skippedList'),
      timestamp: queryField(panel, 'timestamp')
    };
  }

  function attachToTable(): void {
    const table = findResultsTable();
    if (!table) {
      return;
    }

    attachedTable = table;
    movePanelAboveTable(table);
    startObservingTable(table);
  }

  function waitForTable(): void {
    if (tableLocator) {
      return;
    }

    tableLocator = new MutationObserver(() => {
      const table = findResultsTable();
      if (!table) {
        return;
      }
      tableLocator?.disconnect();
      tableLocator = null;
      attachedTable = table;
      movePanelAboveTable(table);
      startObservingTable(table);
    });

    tableLocator.observe(document.body, { childList: true, subtree: true });
  }

  function movePanelAboveTable(table: HTMLTableElement): void {
    if (!panelRefs) {
      return;
    }
    const container = table.closest<HTMLElement>('.table-block') ?? table;
    const header = findPreviousSibling(container, '.table-title');
    const anchor = header ?? container;
    const parent = anchor.parentElement;
    if (!parent) {
      return;
    }
    if (panelRefs.panel.parentElement !== parent || panelRefs.panel.nextElementSibling !== anchor) {
      parent.insertBefore(panelRefs.panel, anchor);
    }
  }

  function findPreviousSibling(start: HTMLElement, selector: string): HTMLElement | null {
    let current: Element | null = start.previousElementSibling;
    let steps = 0;
    while (current && steps < 8) {
      if (current instanceof HTMLElement && current.matches(selector)) {
        return current;
      }
      if (current instanceof HTMLElement && current.classList.contains('table-block')) {
        break;
      }
      current = current.previousElementSibling;
      steps += 1;
    }
    return null;
  }

  function startObservingTable(table: HTMLTableElement): void {
    tableObserver?.disconnect();

    const target: Node = table.tBodies.length ? table.tBodies[0]! : table;

    const compute = () => {
      latestStats = calculateStats(table);
      updatePanel(latestStats, 'Up to date');
    };
    compute();

    tableObserver = new MutationObserver(() => {
      if (scheduledUpdate) {
        window.clearTimeout(scheduledUpdate);
      }
      scheduledUpdate = window.setTimeout(() => {
        scheduledUpdate = null;
        compute();
      }, 120);
    });

    tableObserver.observe(target, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function updatePanel(stats: StatsPayload | null, statusMessage: string): void {
    if (!panelRefs) {
      return;
    }

    panelRefs.status.textContent = statusMessage;

    if (!stats) {
      panelRefs.weighted.textContent = '-';
      panelRefs.simple.textContent = '-';
      panelRefs.includedCourses.textContent = '0';
      panelRefs.includedCredits.textContent = '0';
      panelRefs.totalCourses.textContent = '0';
      panelRefs.totalCredits.textContent = '0';
      setSkippedList([], true);
      panelRefs.timestamp.textContent = '';
      return;
    }

    panelRefs.weighted.textContent =
      stats.averages.weighted !== null ? intlAverage.format(stats.averages.weighted) : '-';
    panelRefs.simple.textContent =
      stats.averages.simple !== null ? intlAverage.format(stats.averages.simple) : '-';
    panelRefs.includedCourses.textContent = stats.counters.includedCourses.toString();
    panelRefs.includedCredits.textContent = intlCredits.format(stats.counters.includedCredits);
    panelRefs.totalCourses.textContent = stats.counters.totalCourses.toString();
    panelRefs.totalCredits.textContent = intlCredits.format(stats.counters.totalCredits);
    setSkippedList(stats.skipped, false);
    panelRefs.timestamp.textContent = `Updated ${new Date(stats.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  }

  function setSkippedList(skipped: SkipSummary[], placeholder: boolean): void {
    if (!panelRefs) {
      return;
    }

    const list = panelRefs.skippedList;
    list.replaceChildren();

    if (placeholder) {
      const item = document.createElement('li');
      item.textContent = 'Waiting for table rows…';
      list.append(item);
      return;
    }

    if (!skipped.length) {
      const item = document.createElement('li');
      item.textContent = 'All graded rows are included.';
      list.append(item);
      return;
    }

    skipped.forEach((entry) => {
      const item = document.createElement('li');
      const examples = entry.examples.length ? ` (ex: ${entry.examples.join(', ')})` : '';
      item.textContent = `${SKIP_REASON_COPY[entry.reason]}: ${entry.count}${examples}`;
      list.append(item);
    });
  }

  function calculateStats(table: HTMLTableElement): StatsPayload {
    const headerIndexes = getHeaderIndexes(table);
    const rows = collectDataRows(table);

    let totalCourses = 0;
    let totalCredits = 0;
    let includedCourses = 0;
    let includedCredits = 0;
    let weightedSum = 0;
    let simpleSum = 0;

    const skipTracker: Record<SkipReason, SkipSummary> = {
      passFail: { reason: 'passFail', count: 0, examples: [] },
      missingCredits: { reason: 'missingCredits', count: 0, examples: [] },
      missingGrade: { reason: 'missingGrade', count: 0, examples: [] }
    };

    rows.forEach((row) => {
      const courseCode = getCellText(row, headerIndexes.course);
      const courseName = getCellText(row, headerIndexes.courseName);
      const creditsText = getCellText(row, headerIndexes.credits);
      const gradeText = getCellText(row, headerIndexes.grade);
      const label = courseCode || courseName || 'okänd kurs';

      const credits = parseCredits(creditsText);
      const grade = interpretGrade(gradeText);

      if (!courseCode && !courseName) {
        return;
      }

      totalCourses += 1;
      if (credits !== null) {
        totalCredits += credits;
      }

      if (credits === null) {
        addSkip(skipTracker.missingCredits, label);
        return;
      }

      if (grade.kind === 'missing') {
        addSkip(skipTracker.missingGrade, label);
        return;
      }

      if (grade.kind === 'passFail') {
        addSkip(skipTracker.passFail, label);
        return;
      }

      includedCourses += 1;
      includedCredits += credits;
      weightedSum += credits * grade.value;
      simpleSum += grade.value;
    });

    const weighted = includedCredits > 0 ? weightedSum / includedCredits : null;
    const simple = includedCourses > 0 ? simpleSum / includedCourses : null;

    const skippedEntries = Object.values(skipTracker).filter((entry) => entry.count > 0);

    return {
      averages: { weighted, simple },
      counters: { includedCourses, includedCredits, totalCourses, totalCredits },
      skipped: skippedEntries,
      timestamp: Date.now()
    };
  }

  function getHeaderIndexes(table: HTMLTableElement): {
    course: number;
    courseName: number;
    credits: number;
    grade: number;
  } {
    const headers = getHeaderCells(table).map((cell) => normalizeText(cell.textContent ?? ''));

    return {
      course: findIndex(headers, ['kurs', 'course']),
      courseName: findIndex(headers, ['kursnamn', 'course name']),
      credits: findIndex(headers, ['hp', 'hogskolepoang', 'credits']),
      grade: findIndex(headers, ['resultat', 'betyg', 'grade', 'result'])
    };
  }

  function getHeaderCells(table: HTMLTableElement): HTMLTableCellElement[] {
    const head = table.tHead;
    if (head && head.rows.length > 0) {
      return Array.from(head.rows[0]!.cells);
    }
    const firstRow = table.rows.item(0);
    return firstRow ? Array.from(firstRow.cells) : [];
  }

  function collectDataRows(table: HTMLTableElement): HTMLTableRowElement[] {
    if (table.tBodies.length) {
      return Array.from(table.tBodies).flatMap((body) => Array.from(body.rows));
    }
    const rows = Array.from(table.rows);
    return rows.length > 1 ? rows.slice(1) : [];
  }

  function findResultsTable(): HTMLTableElement | null {
    const tables = Array.from(document.querySelectorAll('table')).filter(
      (element): element is HTMLTableElement => element instanceof HTMLTableElement
    );
    const keywords = ['kurs', 'hp', 'resultat', 'course', 'credits', 'result'];
    let bestTable: HTMLTableElement | null = null;
    let bestScore = -1;

    tables.forEach((table) => {
      const headers = getHeaderCells(table).map((cell) => normalizeText(cell.textContent ?? ''));
      if (!headers.length) {
        return;
      }
      const score = countMatches(headers, keywords);
      if (score > bestScore) {
        bestTable = table;
        bestScore = score;
      }
    });

    return bestTable && bestScore >= 2 ? bestTable : null;
  }

  function countMatches(headers: string[], keywords: string[]): number {
    return keywords.reduce(
      (sum, keyword) => (headers.some((header) => header.includes(keyword)) ? sum + 1 : sum),
      0
    );
  }

  function findIndex(headers: string[], options: string[]): number {
    const idx = headers.findIndex((header) => options.some((option) => header.includes(option)));
    return idx >= 0 ? idx : 0;
  }

  function getCellText(row: HTMLTableRowElement, index: number): string {
    const cell = row.cells[index];
    return (cell?.textContent ?? '').trim();
  }

  function parseCredits(text: string): number | null {
    if (!text) {
      return null;
    }
    const normalized = text.replace(',', '.').replace(/[^\d.]+/g, '');
    if (!normalized) {
      return null;
    }
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function interpretGrade(
    text: string
  ): { kind: 'numeric'; value: number } | { kind: 'passFail' } | { kind: 'missing' } {
    if (!text) {
      return { kind: 'missing' };
    }

    const normalized = normalizeText(text);

    if (['3', '4', '5'].includes(normalized)) {
      return { kind: 'numeric', value: Number.parseInt(normalized, 10) };
    }

    if (normalized === 'u') {
      return { kind: 'numeric', value: 0 };
    }

    const numericMatch = normalized.match(/^(\d+(?:\.\d+)?)$/);
    if (numericMatch) {
      const captured = numericMatch[1] ?? normalized;
      return { kind: 'numeric', value: Number.parseFloat(captured) };
    }

    if (['g', 'pass', 'godkand', 'p'].includes(normalized)) {
      return { kind: 'passFail' };
    }

    return { kind: 'missing' };
  }

  function addSkip(summary: SkipSummary, label: string): void {
    summary.count += 1;
    if (summary.examples.length < 3) {
      summary.examples.push(label);
    }
  }

  function queryField(parent: ParentNode, field: string): HTMLElement {
    const node = parent.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (!node) {
      throw new Error(`Missing panel element for ${field}`);
    }
    return node;
  }

  function normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }
})();

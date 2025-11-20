type SkipReason = 'passFail' | 'missingCredits' | 'missingGrade';

type SkipSummary = {
  reason: SkipReason;
  count: number;
  examples: string[];
};

type StatsPayload = {
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
};

type ContentScriptResponse = {
  stats: StatsPayload | null;
  hasTable: boolean;
};

const GET_STATS_MESSAGE = 'chalmers-gpa/get-stats';
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

const popupRoot = (() => {
  const element = document.getElementById('popup-root');
  if (!(element instanceof HTMLElement)) {
    throw new Error('Popup root not found');
  }
  return element;
})();
const refreshButton = document.getElementById('popup-refresh') as HTMLButtonElement | null;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });

renderStatus('Loading transcript data…');
refreshButton?.addEventListener('click', () => {
  void fetchStats();
});

void fetchStats();

async function fetchStats(): Promise<void> {
  setRefreshDisabled(true);
  renderStatus('Looking for transcript tab…');
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      renderStatus('Open mex.portal.chalmers.se in the current window and try again.');
      return;
    }

    const response = await sendMessage<ContentScriptResponse>(tab.id, { type: GET_STATS_MESSAGE });
    if (!response?.stats) {
      const message = response?.hasTable
        ? 'Transcript table not yet loaded. Try again once the page finishes loading.'
        : 'No transcript table detected. Navigate to the results page and try again.';
      renderStatus(message);
      return;
    }

    renderStats(response.stats, 'Up to date');
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unable to reach the transcript tab. Make sure the page is open.';
    renderStatus(message);
  } finally {
    setRefreshDisabled(false);
  }
}

function renderStatus(message: string): void {
  popupRoot.innerHTML = `<p class="popup__status">${escapeHtml(message)}</p>`;
}

function renderStats(stats: StatsPayload, status: string): void {
  const weighted =
    stats.averages.weighted !== null ? intlAverage.format(stats.averages.weighted) : '-';
  const simple = stats.averages.simple !== null ? intlAverage.format(stats.averages.simple) : '-';
  const includedCredits = intlCredits.format(stats.counters.includedCredits);
  const totalCredits = intlCredits.format(stats.counters.totalCredits);

  const skippedItems =
    stats.skipped.length > 0
      ? stats.skipped
          .map((entry) => {
            const escapedExamples = entry.examples.map((example) => escapeHtml(example));
            const examples = escapedExamples.length ? ` (ex: ${escapedExamples.join(', ')})` : '';
            return `<li>${SKIP_REASON_COPY[entry.reason]}: ${entry.count}${examples}</li>`;
          })
          .join('')
      : '<li>All graded rows are included.</li>';

  popupRoot.innerHTML = `
    <p class="popup__status">${escapeHtml(status)}</p>
    <div class="metrics">
      <div class="metric">
        <p class="metric__label">Weighted average</p>
        <p class="metric__value">${weighted}</p>
      </div>
      <div class="metric">
        <p class="metric__label">Simple average</p>
        <p class="metric__value">${simple}</p>
      </div>
    </div>
    <div class="counts">
      <p><strong>Included:</strong> ${stats.counters.includedCourses} courses / ${includedCredits} hp</p>
      <p><strong>Total:</strong> ${stats.counters.totalCourses} courses / ${totalCredits} hp</p>
    </div>
    <div class="skipped">
      <p>Excluded rows:</p>
      <ul>${skippedItems}</ul>
    </div>
    <p class="timestamp">Updated ${new Date(stats.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}</p>
  `;
}

function setRefreshDisabled(disabled: boolean): void {
  if (refreshButton) {
    refreshButton.disabled = disabled;
  }
}

function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0]));
  });
}

function sendMessage<T>(tabId: number, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response as T);
    });
  });
}

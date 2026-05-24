import type { NewsItem } from '@/app/api/news/route'

export type SuggestedDate = {
  date: Date
  headline: string
  category: string
}

// ── Keyword scoring ───────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'be', 'been', 'being', 'its',
  'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but',
  'with', 'from', 'by', 'as', 'up', 'out', 'if', 'into', 'than',
  'so', 'it', 'this', 'that', 'will', 'could', 'would', 'should',
  'may', 'might', 'do', 'did', 'does', 'has', 'have', 'had', 'not',
  'no', 'over', 'after', 'before', 'about', 'also', 'more', 'than', 'how',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/** Overlap score: count of tokens from `title` that appear in `headline`. */
export function scoreHeadline(headline: string, title: string): number {
  const titleTokens = new Set(tokenize(title))
  let score = 0
  for (const tok of tokenize(headline)) {
    if (titleTokens.has(tok)) score++
  }
  return score
}

// ── Date parsing ──────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

// Quarter → approximate resolution date (quarter end + ~25 days for earnings release)
const QUARTER_RESOLUTION: Record<number, { month: number; day: number; yearOffset: number }> = {
  1: { month: 3, day: 25, yearOffset: 0 },  // Q1 → ~Apr 25
  2: { month: 6, day: 25, yearOffset: 0 },  // Q2 → ~Jul 25
  3: { month: 9, day: 25, yearOffset: 0 },  // Q3 → ~Oct 25
  4: { month: 0, day: 25, yearOffset: 1 },  // Q4 → ~Jan 25 next year
}

/**
 * Extract future dates from a headline string.
 * Handles:
 *   - "May 28", "January 15, 2026", "Jun 18" (explicit month + day)
 *   - "Q2 2025", "Q3 earnings" (quarter → resolution offset date)
 */
function parseDatesFromText(text: string): Date[] {
  const now = new Date()
  const currentYear = now.getFullYear()
  const candidates: Date[] = []

  // Explicit month + day (+ optional 2-digit or 4-digit year)
  const monthPattern =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(?:20)?(\d{2}))?\b/gi

  for (const m of text.matchAll(monthPattern)) {
    const monthName = m[1].toLowerCase().replace('.', '')
    const day = parseInt(m[2], 10)
    const yearSuffix = m[3] != null ? parseInt(m[3], 10) : null
    const monthIdx = MONTH_MAP[monthName]
    if (monthIdx === undefined || day < 1 || day > 31) continue

    const year =
      yearSuffix !== null
        ? yearSuffix < 50
          ? 2000 + yearSuffix
          : 1900 + yearSuffix
        : currentYear

    let d = new Date(year, monthIdx, day)
    // If the parsed date is already past, try next year (no year was specified)
    if (d.getTime() <= now.getTime() && yearSuffix === null) {
      d = new Date(year + 1, monthIdx, day)
    }
    if (d.getTime() > now.getTime()) candidates.push(d)
  }

  // Quarter mentions: "Q2 2025", "Q3", "Q4 2026"
  const quarterPattern = /\bQ([1-4])\s*(?:20(\d{2}))?\b/gi
  for (const m of text.matchAll(quarterPattern)) {
    const q = parseInt(m[1], 10) as 1 | 2 | 3 | 4
    const yearSuffix = m[2] ? 2000 + parseInt(m[2], 10) : currentYear
    const { month, day, yearOffset } = QUARTER_RESOLUTION[q]
    const d = new Date(yearSuffix + yearOffset, month, day)
    if (d.getTime() > now.getTime()) candidates.push(d)
  }

  // Deduplicate by calendar day
  const seen = new Set<string>()
  return candidates.filter((d) => {
    const k = d.toDateString()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

const MIN_SCORE = 2

/**
 * Given a proposal title and the cached news feed, return up to 3 suggested
 * resolution dates drawn from relevant headlines that mention an explicit date
 * or earnings quarter. Results are sorted earliest-first.
 */
export function suggestResolutionDates(
  proposalTitle: string,
  newsItems: NewsItem[],
): SuggestedDate[] {
  const scored = newsItems
    .map((item) => ({ item, score: scoreHeadline(item.title, proposalTitle) }))
    .filter(({ score }) => score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  const suggestions: SuggestedDate[] = []
  const seen = new Set<string>()

  for (const { item } of scored) {
    for (const date of parseDatesFromText(item.title)) {
      const key = date.toDateString()
      if (seen.has(key)) continue
      seen.add(key)
      suggestions.push({ date, headline: item.title, category: item.category })
    }
    if (suggestions.length >= 3) break
  }

  return suggestions.sort((a, b) => a.date.getTime() - b.date.getTime())
}

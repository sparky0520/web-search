import { DateTime } from 'luxon';
import * as chrono from 'chrono-node';

export type ResolvedKind = 'day' | 'range' | 'since';

export interface TimeCandidate {
  start: DateTime;
  end: DateTime;
  label: string;
  kind: ResolvedKind;
  sinceIsoDate?: string; // YYYY-MM-DD
}

export interface ResolvedPhrase {
  phrase: string;
  kind: ResolvedKind;
  primary: TimeCandidate;
  alternatives: TimeCandidate[];
  assumptionDisclosure?: string;
  sinceDate?: string;
}

export interface TimeResolutionResult {
  hasPastReference: boolean;
  phrases: ResolvedPhrase[];
  candidateDays: DateTime[]; // Unique start-of-day DateTimes in user's timezone, ranked
  assumptionLine?: string;   // Disclose assumption in one line when ambiguous
  sinceDate?: string;        // Earliest or most relevant YYYY-MM-DD for search
}

const WEEKDAY_NAMES: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/**
 * Pure resolver: translates natural-language time expressions into precise
 * timezone-aware DateTime candidates adhering to §5 semantics.
 */
export function resolve(text: string, now: DateTime, tz: string): TimeResolutionResult {
  const localNow = now.setZone(tz);
  const lower = text.toLowerCase();
  const phrases: ResolvedPhrase[] = [];
  const candidateDaysMap = new Map<string, DateTime>();

  function addCandidateDay(dt: DateTime) {
    const sod = dt.setZone(tz).startOf('day');
    const key = sod.toISODate();
    if (key && !candidateDaysMap.has(key)) {
      candidateDaysMap.set(key, sod);
    }
  }

  // 1. Check for "since <date/time/phrase>"
  const sinceMatch = lower.match(/\bsince\s+([^,?.!]+)/i);
  if (sinceMatch) {
    const sinceTarget = sinceMatch[1].trim();
    const resolvedSince = resolveTargetPhrase(sinceTarget, localNow, tz);
    if (resolvedSince) {
      const sinceDate = resolvedSince.primary.start.toISODate() || undefined;
      const phraseObj: ResolvedPhrase = {
        phrase: sinceMatch[0],
        kind: 'since',
        primary: {
          start: resolvedSince.primary.start,
          end: localNow,
          label: `since ${resolvedSince.primary.label}`,
          kind: 'since',
          sinceIsoDate: sinceDate,
        },
        alternatives: resolvedSince.alternatives.map((alt) => ({
          start: alt.start,
          end: localNow,
          label: `since ${alt.label}`,
          kind: 'since',
          sinceIsoDate: alt.start.toISODate() || undefined,
        })),
        sinceDate,
        assumptionDisclosure: resolvedSince.assumptionDisclosure,
      };
      phrases.push(phraseObj);
      addCandidateDay(resolvedSince.primary.start);
      for (const alt of resolvedSince.alternatives) {
        addCandidateDay(alt.start);
      }
    }
  }

  // 2. Check for "last week"
  if (/\blast\s+week\b/i.test(lower)) {
    // Previous calendar week (Mon-Sun)
    const prevWeekMon = localNow.minus({ weeks: 1 }).startOf('week');
    const prevWeekSun = prevWeekMon.endOf('week');
    const phraseObj: ResolvedPhrase = {
      phrase: 'last week',
      kind: 'range',
      primary: {
        start: prevWeekMon,
        end: prevWeekSun,
        label: `${prevWeekMon.toFormat('d MMM')} - ${prevWeekSun.toFormat('d MMM yyyy')}`,
        kind: 'range',
        sinceIsoDate: prevWeekMon.toISODate() || undefined,
      },
      alternatives: [
        {
          start: localNow.minus({ days: 7 }).startOf('day'),
          end: localNow.endOf('day'),
          label: 'trailing 7 days',
          kind: 'range',
          sinceIsoDate: localNow.minus({ days: 7 }).toISODate() || undefined,
        },
      ],
      assumptionDisclosure: `Assuming 'last week' refers to ${prevWeekMon.toFormat('d MMM')} - ${prevWeekSun.toFormat('d MMM yyyy')}.`,
      sinceDate: prevWeekMon.toISODate() || undefined,
    };
    phrases.push(phraseObj);
    // Add all days of last week as candidates
    for (let i = 0; i < 7; i++) {
      addCandidateDay(prevWeekMon.plus({ days: i }));
    }
  }

  // 3. Check for "recently"
  if (/\brecently\b/i.test(lower)) {
    const recentStart = localNow.minus({ days: 14 }).startOf('day');
    const phraseObj: ResolvedPhrase = {
      phrase: 'recently',
      kind: 'range',
      primary: {
        start: recentStart,
        end: localNow.endOf('day'),
        label: `past 14 days (${recentStart.toFormat('d MMM')} - ${localNow.toFormat('d MMM yyyy')})`,
        kind: 'range',
        sinceIsoDate: recentStart.toISODate() || undefined,
      },
      alternatives: [],
      assumptionDisclosure: `Assuming 'recently' covers the past 14 days (${recentStart.toFormat('d MMM')} - ${localNow.toFormat('d MMM yyyy')}).`,
      sinceDate: recentStart.toISODate() || undefined,
    };
    phrases.push(phraseObj);
  }

  // 4. Check for "yesterday"
  if (/\byesterday\b/i.test(lower)) {
    const yDay = localNow.minus({ days: 1 });
    const phraseObj: ResolvedPhrase = {
      phrase: 'yesterday',
      kind: 'day',
      primary: {
        start: yDay.startOf('day'),
        end: yDay.endOf('day'),
        label: yDay.toFormat('EEE d MMM yyyy'),
        kind: 'day',
        sinceIsoDate: yDay.toISODate() || undefined,
      },
      alternatives: [],
    };
    phrases.push(phraseObj);
    addCandidateDay(yDay);
  }

  // 5. Check for "X days ago"
  const daysAgoMatch = lower.match(/\b(\d+)\s+days?\s+ago\b/i);
  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    const targetDay = localNow.minus({ days });
    const phraseObj: ResolvedPhrase = {
      phrase: daysAgoMatch[0],
      kind: 'day',
      primary: {
        start: targetDay.startOf('day'),
        end: targetDay.endOf('day'),
        label: targetDay.toFormat('EEE d MMM yyyy'),
        kind: 'day',
        sinceIsoDate: targetDay.toISODate() || undefined,
      },
      alternatives: [],
    };
    phrases.push(phraseObj);
    addCandidateDay(targetDay);
  }

  // 6. Check for "last <weekday>" e.g. "last Tuesday"
  const lastWeekdayMatch = lower.match(/\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i);
  if (lastWeekdayMatch) {
    const targetWeekday = WEEKDAY_NAMES[lastWeekdayMatch[1].toLowerCase()];
    if (targetWeekday) {
      // In English idiom: "last Tuesday" on a Wednesday:
      // Primary: Tuesday of the previous calendar week
      // Alt: Most recent past Tuesday (yesterday)
      const prevWeekTarget = localNow.startOf('week').minus({ weeks: 1 }).set({ weekday: targetWeekday });
      
      let mostRecentTarget = localNow.set({ weekday: targetWeekday });
      if (mostRecentTarget >= localNow) {
        mostRecentTarget = mostRecentTarget.minus({ weeks: 1 });
      }

      // If the most recent target is in the previous week, both coincide
      const alternatives: TimeCandidate[] = [];
      let disclosure: string | undefined;

      const weekdayCap = lastWeekdayMatch[1].charAt(0).toUpperCase() + lastWeekdayMatch[1].slice(1).toLowerCase();
      if (prevWeekTarget.toISODate() !== mostRecentTarget.toISODate()) {
        alternatives.push({
          start: mostRecentTarget.startOf('day'),
          end: mostRecentTarget.endOf('day'),
          label: mostRecentTarget.toFormat('EEE d MMM yyyy'),
          kind: 'day',
          sinceIsoDate: mostRecentTarget.toISODate() || undefined,
        });
        disclosure = `Assuming 'last ${weekdayCap}' refers to ${prevWeekTarget.toFormat('EEE d MMM')} (alt ${mostRecentTarget.toFormat('EEE d MMM')}).`;
      }

      const phraseObj: ResolvedPhrase = {
        phrase: lastWeekdayMatch[0],
        kind: 'day',
        primary: {
          start: prevWeekTarget.startOf('day'),
          end: prevWeekTarget.endOf('day'),
          label: prevWeekTarget.toFormat('EEE d MMM yyyy'),
          kind: 'day',
          sinceIsoDate: prevWeekTarget.toISODate() || undefined,
        },
        alternatives,
        assumptionDisclosure: disclosure,
        sinceDate: prevWeekTarget.toISODate() || undefined,
      };
      phrases.push(phraseObj);
      addCandidateDay(prevWeekTarget);
      if (alternatives[0]) {
        addCandidateDay(alternatives[0].start);
      }
    }
  }

  // 7. Check for "(on) <weekday> [we...]" (e.g. "on Monday we shortlisted...", "Monday I asked...")
  // Avoid re-matching if already matched by "last <weekday>"
  const weekdayOnlyMatch = lower.match(/\b(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekdayOnlyMatch && !lastWeekdayMatch && !sinceMatch?.[0].includes(weekdayOnlyMatch[1])) {
    const targetWeekday = WEEKDAY_NAMES[weekdayOnlyMatch[1].toLowerCase()];
    if (targetWeekday) {
      // Past context for a weekday:
      // Primary: most recent occurrence of this weekday strictly before now
      let primaryDay = localNow.set({ weekday: targetWeekday });
      if (primaryDay >= localNow) {
        primaryDay = primaryDay.minus({ weeks: 1 });
      }
      // Alt: one week before primary
      const altDay = primaryDay.minus({ weeks: 1 });

      const phraseObj: ResolvedPhrase = {
        phrase: weekdayOnlyMatch[0],
        kind: 'day',
        primary: {
          start: primaryDay.startOf('day'),
          end: primaryDay.endOf('day'),
          label: primaryDay.toFormat('EEE d MMM yyyy'),
          kind: 'day',
          sinceIsoDate: primaryDay.toISODate() || undefined,
        },
        alternatives: [
          {
            start: altDay.startOf('day'),
            end: altDay.endOf('day'),
            label: altDay.toFormat('EEE d MMM yyyy'),
            kind: 'day',
            sinceIsoDate: altDay.toISODate() || undefined,
          },
        ],
        assumptionDisclosure: `Assuming '${weekdayOnlyMatch[0]}' refers to ${primaryDay.toFormat('EEE d MMM')} (alt ${altDay.toFormat('EEE d MMM')}).`,
        sinceDate: primaryDay.toISODate() || undefined,
      };
      phrases.push(phraseObj);
      addCandidateDay(primaryDay);
      addCandidateDay(altDay);
    }
  }

  // 8. Specific Day & Month: e.g. "3 November", "3rd of November", "November 3"
  // §5 rule: "3 November" -> 3 Nov 2026; "3 December" -> 3 Dec 2025 (latest date not in the future)
  const dayMonthRegex = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
  const dmMatch = lower.match(dayMonthRegex);
  if (dmMatch) {
    const day = parseInt(dmMatch[1] || dmMatch[4], 10);
    const monthStr = (dmMatch[2] || dmMatch[3]).toLowerCase();
    const month = MONTH_NAMES[monthStr];

    if (month && day >= 1 && day <= 31) {
      let candidate = DateTime.fromObject({ year: localNow.year, month, day }, { zone: tz });
      // If in the future relative to localNow (comparing calendar dates), roll back to previous year
      if (candidate.startOf('day') > localNow.startOf('day')) {
        candidate = candidate.minus({ years: 1 });
      }

      const phraseObj: ResolvedPhrase = {
        phrase: dmMatch[0],
        kind: 'day',
        primary: {
          start: candidate.startOf('day'),
          end: candidate.endOf('day'),
          label: candidate.toFormat('d MMM yyyy'),
          kind: 'day',
          sinceIsoDate: candidate.toISODate() || undefined,
        },
        alternatives: [],
        sinceDate: candidate.toISODate() || undefined,
      };
      phrases.push(phraseObj);
      addCandidateDay(candidate);
    }
  }

  // 9. Chrono scan as fallback for any expressions not caught above
  try {
    const chronoResults = chrono.parse(text, localNow.toJSDate());
    for (const res of chronoResults) {
      const matchText = res.text.toLowerCase();
      // Skip if already captured
      if (phrases.some((p) => p.phrase.toLowerCase().includes(matchText) || matchText.includes(p.phrase.toLowerCase()))) {
        continue;
      }
      const jsDate = res.start.date();
      let dt = DateTime.fromJSDate(jsDate, { zone: tz });
      if (dt.startOf('day') > localNow.startOf('day')) {
        dt = dt.minus({ years: 1 });
      }
      const phraseObj: ResolvedPhrase = {
        phrase: res.text,
        kind: 'day',
        primary: {
          start: dt.startOf('day'),
          end: dt.endOf('day'),
          label: dt.toFormat('d MMM yyyy'),
          kind: 'day',
          sinceIsoDate: dt.toISODate() || undefined,
        },
        alternatives: [],
        sinceDate: dt.toISODate() || undefined,
      };
      phrases.push(phraseObj);
      addCandidateDay(dt);
    }
  } catch {
    // Non-fatal, regex rules covered authoritative cases
  }

  // Compile final results
  const candidateDays = Array.from(candidateDaysMap.values());
  const hasPastReference = phrases.length > 0;

  // Assumption line (pick first disclosure if present)
  const assumptionLine = phrases.find((p) => p.assumptionDisclosure)?.assumptionDisclosure;

  // Find sinceDate if any phrase is 'since' or has a sinceDate
  const sincePhrase = phrases.find((p) => p.kind === 'since' || p.sinceDate);
  const sinceDate = sincePhrase?.sinceDate;

  return {
    hasPastReference,
    phrases,
    candidateDays,
    assumptionLine,
    sinceDate,
  };
}

/**
 * Resolves a target phrase following "since", e.g. "Monday", "last Tuesday", "3 November", "yesterday"
 */
function resolveTargetPhrase(target: string, now: DateTime, tz: string): { primary: TimeCandidate; alternatives: TimeCandidate[]; assumptionDisclosure?: string } | null {
  const trimmed = target.trim().toLowerCase();
  
  // "yesterday"
  if (trimmed === 'yesterday') {
    const d = now.minus({ days: 1 });
    return {
      primary: {
        start: d.startOf('day'),
        end: d.endOf('day'),
        label: d.toFormat('EEE d MMM yyyy'),
        kind: 'day',
        sinceIsoDate: d.toISODate() || undefined,
      },
      alternatives: [],
    };
  }

  // Weekday name e.g. "monday", "last tuesday"
  const lastMatch = trimmed.match(/\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
  if (lastMatch) {
    const weekday = WEEKDAY_NAMES[lastMatch[1]];
    const prevWeekTarget = now.startOf('week').minus({ weeks: 1 }).set({ weekday });
    let mostRecentTarget = now.set({ weekday });
    if (mostRecentTarget >= now) {
      mostRecentTarget = mostRecentTarget.minus({ weeks: 1 });
    }
    const alts: TimeCandidate[] = [];
    if (prevWeekTarget.toISODate() !== mostRecentTarget.toISODate()) {
      alts.push({
        start: mostRecentTarget.startOf('day'),
        end: mostRecentTarget.endOf('day'),
        label: mostRecentTarget.toFormat('EEE d MMM yyyy'),
        kind: 'day',
        sinceIsoDate: mostRecentTarget.toISODate() || undefined,
      });
    }
    return {
      primary: {
        start: prevWeekTarget.startOf('day'),
        end: prevWeekTarget.endOf('day'),
        label: prevWeekTarget.toFormat('EEE d MMM yyyy'),
        kind: 'day',
        sinceIsoDate: prevWeekTarget.toISODate() || undefined,
      },
      alternatives: alts,
      assumptionDisclosure: `Assuming 'last ${lastMatch[1]}' refers to ${prevWeekTarget.toFormat('EEE d MMM')}.`,
    };
  }

  const singleWeekday = WEEKDAY_NAMES[trimmed];
  if (singleWeekday) {
    let primary = now.set({ weekday: singleWeekday });
    if (primary >= now) {
      primary = primary.minus({ weeks: 1 });
    }
    const alt = primary.minus({ weeks: 1 });
    return {
      primary: {
        start: primary.startOf('day'),
        end: primary.endOf('day'),
        label: primary.toFormat('EEE d MMM yyyy'),
        kind: 'day',
        sinceIsoDate: primary.toISODate() || undefined,
      },
      alternatives: [
        {
          start: alt.startOf('day'),
          end: alt.endOf('day'),
          label: alt.toFormat('EEE d MMM yyyy'),
          kind: 'day',
          sinceIsoDate: alt.toISODate() || undefined,
        },
      ],
      assumptionDisclosure: `Assuming '${target}' refers to ${primary.toFormat('EEE d MMM')}.`,
    };
  }

  // Day & month e.g. "3 november"
  const dm = trimmed.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i);
  if (dm) {
    const day = parseInt(dm[1], 10);
    const month = MONTH_NAMES[dm[2]];
    if (month) {
      let candidate = DateTime.fromObject({ year: now.year, month, day }, { zone: tz });
      if (candidate.startOf('day') > now.startOf('day')) {
        candidate = candidate.minus({ years: 1 });
      }
      return {
        primary: {
          start: candidate.startOf('day'),
          end: candidate.endOf('day'),
          label: candidate.toFormat('d MMM yyyy'),
          kind: 'day',
          sinceIsoDate: candidate.toISODate() || undefined,
        },
        alternatives: [],
      };
    }
  }

  return null;
}

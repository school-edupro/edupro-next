import { describe, expect, it } from 'vitest';
import { matchQuestion, normalise, readDay, readDays, type MatchCandidate } from '../src/matcher';

const TODAY = '2026-11-21';
const C: MatchCandidate[] = [
  {
    id: 'child_attendance',
    keywords: ['attendance', 'absent', 'hazri', 'उपस्थिति'],
    phrases: ['Show my attendance record', 'Kitne din absent tha?', 'मेरी उपस्थिति दिखाओ'],
    params: [{ name: 'days', type: 'days' }],
  },
  {
    id: 'child_dues',
    keywords: ['fees', 'due', 'bakaya', 'बकाया'],
    phrases: ['How much fees is due?', 'Kitni fees baki hai?'],
    params: [],
  },
  {
    id: 'attendance_today',
    keywords: ['attendance of the day', 'attendance by class'],
    params: [
      { name: 'date', type: 'date' },
      { name: 'classId', type: 'classId' },
      { name: 'sectionId', type: 'sectionId' },
    ],
  },
  {
    id: 'fee_defaulters',
    keywords: ['defaulter', 'defaulters'],
    params: [
      { name: 'classId', type: 'classId' },
      { name: 'minAmount', type: 'amount' },
    ],
  },
  { id: 'tie_a', keywords: ['library books'], params: [] },
  { id: 'tie_b', keywords: ['library books'], params: [] },
];
const ctx = {
  today: TODAY,
  classes: [{ id: '6', code: 'VI' }],
  sections: [{ id: '61', label: 'VI-A' }],
};

describe('the chatbot matcher (no outside model)', () => {
  it('picks the query by its words in English, Hinglish and Hindi', () => {
    for (const q of ['Show my attendance record', 'kitne din absent tha', 'मेरी उपस्थिति'])
      expect(matchQuestion(q, C, ctx)).toMatchObject({ kind: 'match', id: 'child_attendance' });
    expect(matchQuestion('Kitni fees baki hai?', C, ctx)).toMatchObject({
      kind: 'match',
      id: 'child_dues',
    });
  });

  it('reads the inputs: a period, a day, a class, a section, an amount', () => {
    expect(matchQuestion('my attendance this week', C, ctx)).toMatchObject({
      params: { days: 7 },
    });
    expect(matchQuestion('attendance last month', C, ctx)).toMatchObject({
      params: { days: 21 + 31 },
    });
    expect(matchQuestion('attendance of the day VI-A yesterday', C, ctx)).toMatchObject({
      id: 'attendance_today',
      params: { date: '2026-11-20', classId: '6', sectionId: '61' },
    });
    expect(matchQuestion('defaulters of class VI above 10,000', C, ctx)).toMatchObject({
      id: 'fee_defaulters',
      params: { classId: '6', minAmount: 10000 },
    });
  });

  it('two queries scoring the same: did you mean', () => {
    expect(matchQuestion('my library books', C, ctx)).toEqual({
      kind: 'ambiguous',
      ids: ['tie_a', 'tie_b'],
    });
  });

  it('declines what is not about school records, and what it does not know', () => {
    expect(matchQuestion('delete my attendance', C, ctx)).toMatchObject({
      kind: 'none',
      reason: 'not_data',
    });
    expect(matchQuestion('tell me a joke', C, ctx)).toMatchObject({
      kind: 'none',
      reason: 'not_data',
    });
    expect(matchQuestion('who won the match', C, ctx)).toMatchObject({
      kind: 'none',
      reason: 'unknown',
    });
    // a short word alone is not enough
    expect(matchQuestion('due?', C, ctx)).toMatchObject({ kind: 'none' });
  });

  it('reads days and periods', () => {
    expect(readDay('2026-10-05', TODAY)).toBe('2026-10-05');
    expect(readDay('aaj', TODAY)).toBe(TODAY);
    expect(readDay('आज', TODAY)).toBe(TODAY);
    expect(readDay('on 12 nov', TODAY)).toBe('2026-11-12');
    expect(readDay('nov 3', TODAY)).toBe('2026-11-03');
    expect(readDay('on 5/10', TODAY)).toBe('2026-10-05');
    expect(readDays('last 10 days', TODAY)).toBe(10);
    expect(readDays('is hafte', TODAY)).toBe(7);
    expect(readDays('इस महीने', TODAY)).toBe(20);
    expect(readDays('nothing here', TODAY)).toBeNull();
    expect(normalise('Haziri?')).toBe(' hazri ');
  });
});

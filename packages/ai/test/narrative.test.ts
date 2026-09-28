import { describe, expect, it } from 'vitest';
import { MockProvider, templateNarrative, writeNarrative } from '../src';

const facts = [
  {
    id: 'fees.collected',
    label: 'Collected in the period',
    value: 125000,
    unit: '₹',
    detail: { receipts: 42, previousPeriod: 100000 },
  },
  {
    id: 'attendance.pct',
    label: 'Attendance for the period',
    value: 91.5,
    unit: '%',
    detail: { previousPeriod: 93.2 },
  },
  { id: 'school.open_alerts', label: 'Open anomaly alerts', value: 0 },
];

describe('narrative (Sprint 16)', () => {
  it('the template cites every fact and words the comparison', () => {
    const text = templateNarrative({
      title: 'Brief',
      period: '1 to 7',
      school: 'Alpha',
      audience: 'principal',
      facts,
      language: 'en',
    });
    expect(text).toContain(
      'Collected in the period: ₹1,25,000 (up ₹25,000 on ₹1,00,000 in the previous period); receipts 42. [fees.collected]',
    );
    expect(text).toContain(
      'Attendance for the period: 91.5% (down 1.7 points on 93.2% in the previous period). [attendance.pct]',
    );
    expect(text).toContain('[school.open_alerts]');
  });

  it('the mock provider uses the template; a model text is checked for unknown citations', async () => {
    const mock = await writeNarrative(new MockProvider(), {
      title: 'Brief',
      period: '1 to 7',
      school: 'Alpha',
      audience: 'principal',
      facts,
      language: 'hi',
    });
    expect(mock.provider).toBe('mock');
    expect(mock.citations).toEqual(['fees.collected', 'attendance.pct', 'school.open_alerts']);
    expect(mock.unknownCitations).toEqual([]);
    expect(mock.costPaise).toBe(0);
    const fake = new MockProvider(
      () => 'Collections rose sharply [fees.collected]. Buses were late [transport.delays].',
    );
    Object.defineProperty(fake, 'name', { value: 'claude' });
    const model = await writeNarrative(fake, {
      title: 'Brief',
      period: '1 to 7',
      school: 'Alpha',
      audience: 'principal',
      facts,
      language: 'en',
    });
    expect(model.citations).toEqual(['fees.collected']);
    expect(model.unknownCitations).toEqual(['transport.delays']);
  });
});

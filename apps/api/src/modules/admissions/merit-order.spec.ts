import { meritOrder } from './merit-order';

const c = (id: string, merit: number | null, dob: string | null) => ({
  id,
  number: `R${id}`,
  merit,
  dob,
});

describe('merit list order (docs/design/40, part 4)', () => {
  it('ranks by merit, then the older child, then a seeded draw that replays', () => {
    const rows = [
      c('1', 70, '2020-05-01'),
      c('2', 85, '2020-01-01'),
      c('3', 70, '2019-11-20'),
      c('4', 70, '2020-05-01'),
      c('5', 70, '2020-05-01'),
      c('6', null, '2019-01-01'),
    ];
    const a = meritOrder(rows, 'seed-one');
    expect(a.needsDraw).toBe(true);
    expect(a.order.map((x) => x.id).slice(0, 2)).toEqual(['2', '3']);
    expect(a.order[0]).toMatchObject({ rank: 1, tie: null });
    // equal merit, older: settled by age; equal merit and birth date: by draw
    expect(a.order[1]).toMatchObject({ rank: 2, tie: 'age' });
    expect(a.order.slice(2, 5).every((x) => x.tie === 'draw')).toBe(true);
    expect(
      a.order
        .slice(2, 5)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['1', '4', '5']);
    // no merit yet: last
    expect(a.order[5]).toMatchObject({ id: '6', rank: 6 });
    // the same seed replays the same order, whatever the input order
    const b = meritOrder([...rows].reverse(), 'seed-one');
    expect(b.order.map((x) => x.id)).toEqual(a.order.map((x) => x.id));
    // some seed gives another order of the drawn group
    const others = ['s2', 's3', 's4', 's5', 's6', 's7'].map((s) =>
      meritOrder(rows, s)
        .order.map((x) => x.id)
        .join(),
    );
    expect(others.some((o) => o !== a.order.map((x) => x.id).join())).toBe(true);
  });

  it('needs no draw when merit and age settle every place', () => {
    const r = meritOrder([c('1', 60, '2020-01-01'), c('2', 60, '2020-02-01')], null);
    expect(r.needsDraw).toBe(false);
    expect(r.order.map((x) => [x.id, x.tie])).toEqual([
      ['1', 'age'],
      ['2', 'age'],
    ]);
  });
});

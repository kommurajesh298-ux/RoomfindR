import {
  getVacancyCountFromRooms,
  getVacancySummary,
  resolveVacancyCount,
} from '../../../../shared/vacancy';

describe('getVacancySummary', () => {
  it('formats plural vacancy labels consistently', () => {
    expect(getVacancySummary(4)).toEqual({
      count: 4,
      isSoldOut: false,
      label: '4 Beds Left',
      shortLabel: '4 Beds Left',
    });
  });

  it('formats singular vacancy labels consistently', () => {
    expect(getVacancySummary(1)).toEqual({
      count: 1,
      isSoldOut: false,
      label: '1 Bed Left',
      shortLabel: '1 Bed Left',
    });
  });

  it('marks non-positive vacancy values as sold out', () => {
    expect(getVacancySummary(0)).toEqual({
      count: 0,
      isSoldOut: true,
      label: 'Sold Out',
      shortLabel: 'Sold Out',
    });
  });

  it('prefers live room availability when rooms are present', () => {
    expect(
      resolveVacancyCount(4, [
        { availableCount: 1 },
        { capacity: 3, bookedCount: 1 },
      ]),
    ).toBe(3);
  });

  it('falls back to the stored vacancy count when rooms are missing', () => {
    expect(resolveVacancyCount(4, [])).toBe(4);
  });

  it('sums room records consistently', () => {
    expect(
      getVacancyCountFromRooms({
        a: { availableCount: 2 },
        b: { capacity: 3, bookedCount: 1 },
      }),
    ).toBe(4);
  });
});

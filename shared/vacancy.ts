export type VacancySummary = {
  count: number;
  isSoldOut: boolean;
  label: string;
  shortLabel: string;
};

export type VacancyRoomLike = {
  availableCount?: number | null;
  capacity?: number | null;
  bookedCount?: number | null;
};

type VacancyRoomCollection =
  | VacancyRoomLike[]
  | Record<string, VacancyRoomLike>
  | null
  | undefined;

const normalizeVacancyCount = (value: number | null | undefined) =>
  Math.max(0, Number(value || 0) || 0);

const normalizeRooms = (rooms: VacancyRoomCollection): VacancyRoomLike[] => {
  if (!rooms) return [];
  return Array.isArray(rooms) ? rooms : Object.values(rooms);
};

const deriveRoomVacancyCount = (room: VacancyRoomLike) => {
  if (room.availableCount !== undefined && room.availableCount !== null) {
    return normalizeVacancyCount(room.availableCount);
  }

  if (room.capacity !== undefined || room.bookedCount !== undefined) {
    return Math.max(
      0,
      normalizeVacancyCount(room.capacity) - normalizeVacancyCount(room.bookedCount),
    );
  }

  return 0;
};

export const getVacancyCountFromRooms = (
  rooms: VacancyRoomCollection,
): number | null => {
  const normalizedRooms = normalizeRooms(rooms);

  if (normalizedRooms.length === 0) {
    return null;
  }

  return normalizedRooms.reduce(
    (total, room) => total + deriveRoomVacancyCount(room),
    0,
  );
};

export const resolveVacancyCount = (
  value: number | null | undefined,
  rooms?: VacancyRoomCollection,
) => {
  const roomVacancyCount = getVacancyCountFromRooms(rooms);
  return roomVacancyCount ?? normalizeVacancyCount(value);
};

export const getVacancySummary = (
  value: number | null | undefined,
): VacancySummary => {
  const count = normalizeVacancyCount(value);

  if (count <= 0) {
    return {
      count: 0,
      isSoldOut: true,
      label: "Sold Out",
      shortLabel: "Sold Out",
    };
  }

  const unit = count === 1 ? "Bed" : "Beds";
  const label = `${count} ${unit} Left`;

  return {
    count,
    isSoldOut: false,
    label,
    shortLabel: label,
  };
};

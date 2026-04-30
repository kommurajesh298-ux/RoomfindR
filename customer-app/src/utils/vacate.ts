export const getRemainingVacateDays = (dueDate?: string | null): number | null => {
    if (!dueDate) return null;

    const parsedDueDate = new Date(dueDate);
    if (Number.isNaN(parsedDueDate.getTime())) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    parsedDueDate.setHours(0, 0, 0, 0);

    const diffMs = parsedDueDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffMs / 86400000);

    return diffDays > 0 ? diffDays : null;
};

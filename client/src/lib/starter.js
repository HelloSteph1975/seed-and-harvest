// Text for a starter row in the screen language: the pack's version while the row is still an
// untouched starter, else the row's own text (the owner's edits always show as typed).
export const starterText = (tc, row, field, fallback) => tc(row?.is_starter ? row.starter_key : null, field, fallback);

/** Shared by the physical transition and its speech projection. */
export const bookTiming = { introduction: 4.2, enter: 4.2, turn: 1.1 } as const;
export const bookBoundary = (fromWorld: boolean, toWorld: boolean) =>
  fromWorld && !toWorld ? bookTiming.enter : bookTiming.turn;

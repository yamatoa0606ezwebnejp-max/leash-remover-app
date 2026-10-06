// English is the source of truth: every key starts here, and `ja` must match its shape.
export const en = {
  common: {
    next: 'Next',
    startOver: 'Start Over',
  },
  compare: {
    title: 'Before & After',
    before: 'Before',
    after: 'After',
    holdHint: 'Press and hold to see the original',
  },
};

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Dictionary = Widen<typeof en>;

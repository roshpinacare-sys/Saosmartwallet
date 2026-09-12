# scripts/

תיקיית-סקריפטים של הרשת — שורש-מאונדקס במוח-הקוד AxiomState
(`AXIOM_ROOTS.scripts` ב-`src/lib/axiom/runtime.ts`).

כל קובץ שיוצב כאן נסרק לגרף-ה-AST בסנכרון
`POST /api/code/sync {"root":"scripts"}` וזמין לשאילתות-DSL ולבאנדלים
דרך `/api/code/query` ו-`/api/code/bundle`.

הסכם-מקומות: הכלים המבצעיים חיים ב-`tools/` (לא מאונדקסים),
הסקריפטים לשימוש-חוזר של-הרשת חיים כאן (מאונדקסים לסוכנים).

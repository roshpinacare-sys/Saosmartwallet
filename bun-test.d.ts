/// <reference types="bun-types" />
// Bun test types for the whole program (packages/**/test/*.ts import 'bun:test').
// bun-types is already a devDependency; it sits outside the @types/* auto-include
// scope, so it must be referenced explicitly. artery-wallet measured the gap at
// aa1394e (typecheck TS2307 'bun:test') — this file closes it for every future test.

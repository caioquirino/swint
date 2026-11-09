export const KEYCLOAK_ORIGIN = process.env['E2E_KEYCLOAK_ORIGIN'] ?? 'http://localhost:8080';
export const INTERVIEWER = { username: 'interviewer1', password: 'password' } as const;
/** Seeded by the API in development and by the compose `api` service (SEED_DEV_DATA=true). */
export const SEED_TEMPLATE = 'Design a URL shortener';
/** The seed template's starting board: three labelled boxes (3 rectangles + 3 texts). */
export const SEED_ELEMENTS = 6;
export const SEED_RECTANGLES = 3;

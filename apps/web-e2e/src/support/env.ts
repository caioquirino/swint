export const KEYCLOAK_ORIGIN = process.env['E2E_KEYCLOAK_ORIGIN'] ?? 'http://localhost:8080';
export const INTERVIEWER = { username: 'interviewer1', password: 'password' } as const;
/** Seeded by the API in development and by the compose `api` service (SEED_DEV_DATA=true). */
export const SEED_TEMPLATE = 'Design a URL shortener';

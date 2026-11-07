/** Opaque Main-owned credential handles, never credentials or masked credential fragments. */
export const isSecretReference = (value: unknown): value is string =>
  typeof value === 'string' && /^enso-secret:[0-9a-f-]{36}$/.test(value);

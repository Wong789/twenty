export const backendGraphQLUrl = new URL(
  '/graphql',
  process.env.BACKEND_BASE_URL,
).toString();

export const metadataGraphQLUrl = new URL(
  '/metadata',
  process.env.BACKEND_BASE_URL,
).toString();

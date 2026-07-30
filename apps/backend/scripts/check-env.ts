import { allowedFrontendOrigins, runtimeConfig, validateRuntimeConfig } from '../src/config.js';

validateRuntimeConfig();

const optionalProviders = [
  ['Gmail', ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']],
  ['Google Jobs via SerpAPI', ['SERPAPI_API_KEY', 'SERP_API_KEY']],
  ['Adzuna', ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY']],
  ['USAJobs', ['USAJOBS_API_KEY', 'USAJOBS_USER_AGENT', 'USAJOBS_EMAIL']],
] as const;

const providerState = optionalProviders.map(([name, keys]) => {
  const configured = name === 'Google Jobs via SerpAPI'
    ? keys.some((key) => Boolean(process.env[key]?.trim()))
    : name === 'USAJobs'
      ? Boolean(process.env.USAJOBS_API_KEY?.trim() && (process.env.USAJOBS_USER_AGENT?.trim() || process.env.USAJOBS_EMAIL?.trim()))
      : keys.every((key) => Boolean(process.env[key]?.trim()));
  return `${name}: ${configured ? 'configured' : 'not configured (optional)'}`;
});

console.log('RoleMatch backend environment is valid.');
console.log(`Frontend: ${runtimeConfig.frontendUrl}`);
console.log(`Backend: ${runtimeConfig.backendPublicUrl}`);
console.log(`CORS: ${allowedFrontendOrigins().join(', ')}`);
providerState.forEach((line) => console.log(line));

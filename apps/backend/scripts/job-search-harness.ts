import assert from 'node:assert/strict';
import { distanceMiles, resolveLocationCoordinate, suggestLocations } from '../src/jobs/locationService.js';
import { extractSalary, matchesFilters, matchesLocation } from '../src/jobs/normalization.js';
import { calculateProfileMatchScore, type ProfileMatchProfile } from '../src/jobs/profileMatch.js';
import type { JobSearchFilters, NormalizedJob } from '../src/jobs/types.js';

function job(title: string, overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: 'Test',
    company: 'Acme',
    title,
    location: 'Boston, MA',
    remote: false,
    employmentType: 'Full time',
    experienceLevel: 'Mid level',
    jobUrl: `https://example.com/${encodeURIComponent(title)}`,
    description: '',
    requirements: [],
    tags: [],
    ...overrides,
  };
}

const boston = suggestLocations('Boston, MA', 5).find((location) => (
  location.countryCode === 'US' && location.region === 'MA'
));
assert.ok(boston, 'Boston, Massachusetts should be available as a selected location.');

const bostonFilters: JobSearchFilters = {
  location: boston.label,
  locationCity: boston.city,
  locationRegion: boston.region,
  locationCountry: boston.countryCode,
  locationCountryName: boston.countryName,
  locationLat: boston.latitude,
  locationLng: boston.longitude,
  locationRadiusMiles: 50,
  includeRemote: false,
  limit: 100,
};

const bostonUk = resolveLocationCoordinate('Boston, United Kingdom', { countryCode: 'US', region: 'MA' });
const bostonUkAbbreviation = resolveLocationCoordinate('Boston, U.K.', { countryCode: 'US', region: 'MA' });
const cambridgeUk = resolveLocationCoordinate('Cambridge, England', { countryCode: 'US', region: 'MA' });
const parisFrance = resolveLocationCoordinate('Paris, France', { countryCode: 'US', region: 'MA' });
const cambridgeMa = resolveLocationCoordinate('Cambridge, MA', { countryCode: 'US', region: 'MA' });
assert.ok(bostonUk && bostonUkAbbreviation && cambridgeUk && parisFrance && cambridgeMa, 'Named locations should resolve to coordinates.');
assert.ok(distanceMiles(boston, bostonUk) > 1000, 'Explicit UK country must beat a U.S. search hint.');
assert.ok(distanceMiles(boston, bostonUkAbbreviation) > 1000, 'Dotted country abbreviations must beat a U.S. search hint.');
assert.ok(distanceMiles(boston, cambridgeUk) > 1000, 'England must not resolve to Massachusetts.');
assert.ok(distanceMiles(boston, parisFrance) > 1000, 'France must not resolve to a same-named U.S. city.');
assert.ok(distanceMiles(boston, cambridgeMa) < 50, 'Cambridge, Massachusetts should remain inside the Boston radius.');
assert.equal(matchesLocation(job('Engineer', { location: 'Boston, United Kingdom' }), bostonFilters), false);
assert.equal(matchesLocation(job('Engineer', { location: 'Cambridge, MA' }), bostonFilters), true);
assert.equal(matchesLocation(job('Engineer', { location: 'Remote', remote: true }), { ...bostonFilters, includeRemote: true }), true);

assert.equal(matchesFilters(job('Mechanical Engineer'), { query: 'software engineer', limit: 100 }), false);
assert.equal(matchesFilters(job('Engineering Manager', { description: 'Lead software teams.' }), { query: 'software engineer', limit: 100 }), false);
assert.equal(matchesFilters(job('Software Engineer', { description: 'Build APIs with Python.' }), { query: 'Python', limit: 100 }), true);
assert.equal(matchesFilters(job('Software Engineer', { company: 'Google' }), { query: 'Google', limit: 100 }), true);
assert.equal(matchesFilters(job('Software Engineer', { employmentType: 'Full-time' }), { employmentType: 'Full time', limit: 100 }), true);

assert.equal(matchesFilters(job('Engineer'), { minSalary: 150_000, limit: 100 }), true, 'Unknown salaries remain eligible.');
assert.equal(matchesFilters(job('Engineer', { salaryMax: 100_000, currency: 'USD' }), { minSalary: 150_000, limit: 100 }), false);
assert.equal(matchesFilters(job('Engineer', { salaryMax: 100_000, currency: 'EUR' }), { minSalary: 150_000, limit: 100 }), true, 'A USD filter must not compare raw foreign-currency values.');
assert.deepEqual(extractSalary('Salary: $120,000 - $145,000 per year.'), {
  salaryMin: 120_000,
  salaryMax: 145_000,
  salaryRange: '$120,000 - $145,000',
  currency: 'USD',
});
assert.deepEqual(extractSalary('Salary: \u20ac70k - \u20ac90k.', undefined, undefined), {
  salaryMin: 70_000,
  salaryMax: 90_000,
  salaryRange: '\u20ac70,000 - \u20ac90,000',
  currency: 'EUR',
});
assert.deepEqual(extractSalary('Reference number 123456. Applications close Friday.'), {});

const profile: ProfileMatchProfile = {
  targetRoles: ['Software Engineer'],
  skills: ['TypeScript', 'React', 'Python', 'SQL'],
  workHistory: [{ title: 'Software Engineering Intern', skills: ['TypeScript'], highlights: ['Built REST APIs'] }],
  educationHistory: [{ degree: 'Bachelor of Science', field: 'Computer Science' }],
  preferredLocations: ['Boston, MA'],
  autofillAnswers: { yearsProfessionalExperience: '2 years', sponsorshipRequired: 'No' },
};
const detailedMatch = calculateProfileMatchScore(job('Software Engineer', {
  description: 'Build TypeScript and React services. Bachelor degree preferred.',
  requirements: ['Experience with TypeScript, React, SQL, and REST APIs.'],
  tags: ['TypeScript', 'React', 'SQL'],
}), { query: 'software engineer', limit: 100 }, profile);
const sparseMatch = calculateProfileMatchScore(job('Software Engineer'), { query: 'software engineer', limit: 100 }, profile);
const unrelatedMatch = calculateProfileMatchScore(job('Store Manager', {
  description: 'Lead retail operations and merchandise inventory.',
  tags: ['Retail'],
}), { query: 'software engineer', limit: 100 }, profile);
assert.ok(detailedMatch > sparseMatch, 'Detailed matching evidence should improve the score.');
assert.ok(sparseMatch >= 55, 'Missing job details should be treated as unknown rather than a mismatch.');
assert.ok(sparseMatch - unrelatedMatch >= 25, 'An exact target role should clearly outrank an unrelated role.');

console.log(JSON.stringify({
  location: 'passed',
  filters: 'passed',
  salary: 'passed',
  profileScores: { detailedMatch, sparseMatch, unrelatedMatch },
}, null, 2));

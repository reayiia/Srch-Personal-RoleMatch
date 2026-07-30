import { calculateMatchScore as calculateSearchRelevanceScore, normalizeText } from './normalization.js';
import type { JobSearchFilters, NormalizedJob } from './types.js';

interface ProfileWorkEntry {
  title?: string;
  highlights?: string[];
  skills?: string[];
}

interface ProfileProjectEntry {
  name?: string;
  role?: string;
  description?: string;
  technologies?: string[];
}

interface ProfileEducationEntry {
  degree?: string;
  field?: string;
  notes?: string;
  courses?: string[];
}

interface ProfileCertificationEntry {
  name?: string;
  issuer?: string;
}

interface ProfileAutofillAnswers {
  authorizedToWork?: string;
  sponsorshipRequired?: string;
  yearsProfessionalExperience?: string;
  desiredSalary?: string;
  willingToRelocate?: string;
  custom?: Array<{ label?: string; keywords?: string; answer?: string }>;
}

export interface ProfileMatchProfile {
  location?: string | null;
  education?: string | null;
  workExperience?: string | null;
  workAuthorization?: string | null;
  major?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  targetRoles?: string[] | null;
  relevantCourses?: string[] | null;
  preferredLocations?: string[] | null;
  salaryMinimum?: string | null;
  educationHistory?: ProfileEducationEntry[] | null;
  workHistory?: ProfileWorkEntry[] | null;
  projectHistory?: ProfileProjectEntry[] | null;
  certifications?: ProfileCertificationEntry[] | null;
  autofillAnswers?: ProfileAutofillAnswers | null;
}

interface WeightedTerm {
  value: string;
  weight: number;
}

interface CandidateSignals {
  roleTerms: WeightedTerm[];
  skillTerms: WeightedTerm[];
  experienceTerms: WeightedTerm[];
  educationTerms: WeightedTerm[];
  preferredLocations: string[];
  desiredSalary: number | undefined;
  yearsExperience: number | undefined;
  sponsorshipRequired: string;
  authorizedToWork: string;
  willingToRelocate: string;
  signalCount: number;
}

const termStopWords = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'and', 'another', 'any', 'are', 'because',
  'been', 'being', 'both', 'but', 'can', 'class', 'company', 'course', 'create', 'created', 'data',
  'doing', 'done', 'each', 'from', 'have', 'into', 'more', 'most', 'over', 'role', 'school', 'some',
  'such', 'that', 'their', 'them', 'then', 'there', 'this', 'through', 'using', 'with', 'work',
  'worked', 'working', 'your',
]);

function cleanTerm(value?: string | null) {
  return normalizeText(value)
    .replace(/[^a-z0-9+#.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForSearch(value?: string | null) {
  return cleanTerm(value).replace(/\./g, ' ');
}

function toArray<T>(value?: T[] | null) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function addTerm(map: Map<string, WeightedTerm>, value: string | null | undefined, weight: number) {
  const term = cleanTerm(value);
  if (!term) return;
  if (term.length <= 2 && !['c#', 'c++', 'go', 'ui', 'ux'].includes(term)) return;
  if (termStopWords.has(term)) return;

  const existing = map.get(term);
  if (!existing || existing.weight < weight) {
    map.set(term, { value: term, weight });
  }
}

function addKeywords(map: Map<string, WeightedTerm>, value: string | null | undefined, weight: number, limit = 16) {
  const words = cleanTerm(value)
    .split(' ')
    .filter((word) => word.length > 3 && !termStopWords.has(word) && !/^\d+$/.test(word));

  Array.from(new Set(words)).slice(0, limit).forEach((word) => addTerm(map, word, weight));
}

function parseNumber(value?: string | null) {
  if (!value) return undefined;

  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match?.[0]) return undefined;

  const number = Number(match[0]);
  if (!Number.isFinite(number)) return undefined;

  return /\bk\b/i.test(value) || number < 1000 ? Math.round(number * 1000) : Math.round(number);
}

function parseYears(value?: string | null) {
  if (!value) return undefined;

  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match?.[0]) return undefined;

  const years = Number(match[0]);
  return Number.isFinite(years) ? years : undefined;
}

function weightedTerms(map: Map<string, WeightedTerm>) {
  return Array.from(map.values());
}

function buildCandidateSignals(profile?: ProfileMatchProfile | null): CandidateSignals | null {
  if (!profile) return null;

  const roleTerms = new Map<string, WeightedTerm>();
  const skillTerms = new Map<string, WeightedTerm>();
  const experienceTerms = new Map<string, WeightedTerm>();
  const educationTerms = new Map<string, WeightedTerm>();

  toArray(profile.targetRoles).forEach((role) => addTerm(roleTerms, role, 1.5));
  toArray(profile.skills).forEach((skill) => addTerm(skillTerms, skill, 1.5));
  toArray(profile.relevantCourses).forEach((course) => {
    addTerm(skillTerms, course, 0.9);
    addTerm(educationTerms, course, 1);
  });

  toArray(profile.workHistory).forEach((entry) => {
    addTerm(roleTerms, entry.title, 0.9);
    addKeywords(experienceTerms, entry.title, 0.8, 6);
    toArray(entry.skills).forEach((skill) => addTerm(skillTerms, skill, 1.3));
    toArray(entry.highlights).forEach((highlight) => addKeywords(experienceTerms, highlight, 0.75, 10));
  });

  toArray(profile.projectHistory).forEach((entry) => {
    addTerm(roleTerms, entry.role, 0.7);
    addKeywords(experienceTerms, entry.name, 0.6, 6);
    addKeywords(experienceTerms, entry.description, 0.7, 14);
    toArray(entry.technologies).forEach((technology) => addTerm(skillTerms, technology, 1.2));
  });

  toArray(profile.educationHistory).forEach((entry) => {
    addTerm(educationTerms, entry.degree, 0.9);
    addTerm(educationTerms, entry.field, 1.1);
    addKeywords(educationTerms, entry.notes, 0.6, 10);
    toArray(entry.courses).forEach((course) => {
      addTerm(skillTerms, course, 0.8);
      addTerm(educationTerms, course, 1);
    });
  });

  toArray(profile.certifications).forEach((entry) => {
    addTerm(skillTerms, entry.name, 1.1);
    addTerm(educationTerms, entry.name, 1.2);
    addTerm(educationTerms, entry.issuer, 0.6);
  });

  addTerm(educationTerms, profile.major, 1.1);
  addKeywords(educationTerms, profile.education, 0.7, 12);
  addKeywords(experienceTerms, profile.workExperience, 0.7, 18);
  addKeywords(experienceTerms, profile.bio, 0.5, 12);

  toArray(profile.autofillAnswers?.custom).forEach((entry) => {
    addKeywords(experienceTerms, entry.label, 0.4, 6);
    addKeywords(experienceTerms, entry.keywords, 0.7, 8);
  });

  const preferredLocations = [
    ...toArray(profile.preferredLocations),
    profile.location,
  ].map((location) => cleanTerm(location)).filter(Boolean);
  const desiredSalary = parseNumber(profile.salaryMinimum ?? profile.autofillAnswers?.desiredSalary);
  const yearsExperience = parseYears(profile.autofillAnswers?.yearsProfessionalExperience);
  const authorizedToWork = cleanTerm(profile.workAuthorization ?? profile.autofillAnswers?.authorizedToWork);
  const sponsorshipRequired = cleanTerm(profile.autofillAnswers?.sponsorshipRequired);
  const willingToRelocate = cleanTerm(profile.autofillAnswers?.willingToRelocate);

  const signals = {
    roleTerms: weightedTerms(roleTerms),
    skillTerms: weightedTerms(skillTerms),
    experienceTerms: weightedTerms(experienceTerms),
    educationTerms: weightedTerms(educationTerms),
    preferredLocations,
    desiredSalary,
    yearsExperience,
    sponsorshipRequired,
    authorizedToWork,
    willingToRelocate,
  };

  const signalCount = signals.roleTerms.length
    + signals.skillTerms.length
    + signals.experienceTerms.length
    + signals.educationTerms.length
    + signals.preferredLocations.length
    + (desiredSalary ? 1 : 0)
    + (yearsExperience ? 1 : 0)
    + (authorizedToWork || sponsorshipRequired ? 1 : 0);

  return { ...signals, signalCount };
}

function containsToken(haystack: string, token: string) {
  return new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(haystack);
}

function termCredit(haystack: string, term: string) {
  const normalizedTerm = normalizeForSearch(term);
  if (!normalizedTerm) return 0;

  if (normalizedTerm.includes(' ') && haystack.includes(normalizedTerm)) return 1;
  if (!normalizedTerm.includes(' ')) return containsToken(haystack, normalizedTerm) ? 1 : 0;

  const tokens = normalizedTerm
    .split(' ')
    .filter((token) => token.length > 2 && !termStopWords.has(token));
  if (tokens.length === 0) return 0;

  const matchedTokens = tokens.filter((token) => containsToken(haystack, token)).length;
  const coverage = matchedTokens / tokens.length;

  return coverage >= 0.5 ? coverage * 0.75 : 0;
}

function weightedCoverage(
  terms: WeightedTerm[],
  haystacks: Array<{ text: string; credit: number }>,
  maxScore: number,
  fullCreditWeight?: number,
) {
  if (terms.length === 0) return 0;

  const totalWeight = terms.reduce((sum, term) => sum + term.weight, 0);
  const matchedWeight = terms.reduce((sum, term) => {
    const bestCredit = haystacks.reduce((best, haystack) => (
      Math.max(best, termCredit(haystack.text, term.value) * haystack.credit)
    ), 0);
    return sum + (term.weight * bestCredit);
  }, 0);
  const requiredWeightForFullCredit = fullCreditWeight ? Math.min(totalWeight, fullCreditWeight) : totalWeight;

  return Math.min(maxScore, Math.round((matchedWeight / requiredWeightForFullCredit) * maxScore));
}

function experienceLevelScore(job: NormalizedJob, yearsExperience?: number) {
  if (!job.experienceLevel) return 4;
  if (typeof yearsExperience !== 'number') return 3;

  const level = normalizeText(job.experienceLevel);
  if (level.includes('intern')) return yearsExperience <= 1 ? 6 : 3;
  if (level.includes('entry')) return yearsExperience <= 3 ? 6 : 4;
  if (level.includes('senior') || level.includes('leadership')) return yearsExperience >= 5 ? 6 : 2;
  if (level.includes('mid')) return yearsExperience >= 2 ? 6 : 3;

  return 3;
}

function educationRequirementScore(job: NormalizedJob, signals: CandidateSignals) {
  const requirementText = normalizeForSearch(`${job.requirements.join(' ')} ${job.description}`);
  const educationCoverage = weightedCoverage(signals.educationTerms, [{ text: requirementText, credit: 1 }], 7, 3);
  const hasDegreeRequirement = /\b(bachelor|degree|bs|ba|master|ms|phd|college|university)\b/.test(requirementText);
  const hasEducationSignal = signals.educationTerms.length > 0;

  if (!hasDegreeRequirement) return 6;

  return Math.min(10, educationCoverage + (hasEducationSignal ? 3 : 0));
}

function logisticsScore(job: NormalizedJob, signals: CandidateSignals) {
  const jobLocation = cleanTerm(job.location);
  const preferredLocations = signals.preferredLocations;
  const wantsRemote = preferredLocations.some((location) => /remote|anywhere|work from home/.test(location));
  const locationMatches = preferredLocations.some((location) => location && jobLocation.includes(location));

  let locationScore = 4;
  if (preferredLocations.length > 0) {
    if (job.remote && wantsRemote) locationScore = 6;
    else if (locationMatches) locationScore = 6;
    else if (job.remote) locationScore = 5;
    else if (/yes|true|open|willing/.test(signals.willingToRelocate ?? '')) locationScore = 4;
    else locationScore = 2;
  }

  let salaryScore = 3;
  if (signals.desiredSalary && job.salaryMax && (!job.currency || job.currency.toUpperCase() === 'USD')) {
    salaryScore = job.salaryMax >= signals.desiredSalary
      ? 5
      : Math.max(1, Math.round((job.salaryMax / signals.desiredSalary) * 4));
  }

  const jobText = cleanTerm(`${job.description} ${job.requirements.join(' ')}`);
  const needsSponsorship = /yes|true|required|need/.test(signals.sponsorshipRequired ?? '');
  const doesNotNeedSponsorship = /no|false|not/.test(signals.sponsorshipRequired ?? '');
  const jobMentionsSponsorship = /visa|sponsor|sponsorship|work authorization|authorized to work/.test(jobText);
  const jobRulesOutSponsorship = /no sponsorship|not sponsor|unable to sponsor|without sponsorship/.test(jobText);

  let authorizationScore = 2;
  if (signals.authorizedToWork || signals.sponsorshipRequired) {
    if (needsSponsorship && jobRulesOutSponsorship) authorizationScore = 0;
    else if (needsSponsorship && jobMentionsSponsorship) authorizationScore = 4;
    else if (doesNotNeedSponsorship) authorizationScore = 4;
    else authorizationScore = 3;
  }

  return Math.min(15, locationScore + salaryScore + authorizationScore);
}

function profileConfidence(signals: CandidateSignals) {
  if (signals.signalCount >= 10) return 1;
  if (signals.signalCount >= 6) return 0.9;
  if (signals.signalCount >= 4) return 0.8;
  return 0.65;
}

export function calculateProfileMatchScore(job: NormalizedJob, filters: JobSearchFilters, profile?: ProfileMatchProfile | null) {
  const searchRelevanceScore = calculateSearchRelevanceScore(job, filters);
  const signals = buildCandidateSignals(profile);

  if (!signals || signals.signalCount < 3) {
    return searchRelevanceScore;
  }

  const titleText = normalizeForSearch(`${job.title} ${job.normalizedTitle ?? ''}`);
  const priorityJobText = normalizeForSearch(`${job.title} ${job.normalizedTitle ?? ''} ${job.tags.join(' ')} ${job.requirements.join(' ')}`);
  const fullJobText = normalizeForSearch(`${job.title} ${job.company} ${job.description} ${job.requirements.join(' ')} ${job.tags.join(' ')}`);
  const hasDetailedJobEvidence = job.tags.length > 0
    || job.requirements.length > 0
    || normalizeForSearch(job.description).split(' ').filter(Boolean).length >= 30;

  const roleScore = weightedCoverage(signals.roleTerms, [
    { text: titleText, credit: 1 },
    { text: fullJobText, credit: 0.45 },
  ], 20, 2.8);

  const calculatedSkillsScore = weightedCoverage(signals.skillTerms, [
    { text: priorityJobText, credit: 1 },
    { text: fullJobText, credit: 0.75 },
  ], 35, 6);
  const skillsScore = hasDetailedJobEvidence ? calculatedSkillsScore : Math.max(14, calculatedSkillsScore);

  const experienceKeywordScore = weightedCoverage(signals.experienceTerms, [
    { text: priorityJobText, credit: 0.7 },
    { text: fullJobText, credit: 1 },
  ], 14, 5.5);
  const experienceScore = Math.min(
    20,
    (hasDetailedJobEvidence ? experienceKeywordScore : Math.max(5, experienceKeywordScore))
      + experienceLevelScore(job, signals.yearsExperience),
  );
  const educationScore = educationRequirementScore(job, signals);
  const preferenceScore = logisticsScore(job, signals);
  const searchContextScore = Math.round((searchRelevanceScore / 99) * 5);

  const rawScore = roleScore + skillsScore + experienceScore + educationScore + preferenceScore + searchContextScore;
  const confidence = profileConfidence(signals);
  const blendedScore = Math.round((rawScore * confidence) + (searchRelevanceScore * (1 - confidence)));

  return Math.max(1, Math.min(99, blendedScore));
}

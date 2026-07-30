import path from 'node:path';
import { createRequire } from 'node:module';
import mammoth from 'mammoth';
import type {
  CertificationEntry,
  EducationEntry,
  ProjectEntry,
  WorkHistoryEntry,
} from '../db/schema.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buffer: Buffer) => Promise<{ text: string }>;

export interface ResumeProfileDraft {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  education?: string;
  workExperience?: string;
  skills: string[];
  relevantCourses: string[];
  educationHistory: EducationEntry[];
  workHistory: WorkHistoryEntry[];
  projectHistory: ProjectEntry[];
  certifications: CertificationEntry[];
}

export interface ResumeParseResult {
  draft: ResumeProfileDraft;
  suggestedSkills: string[];
  targetRoleSuggestions: string[];
  warnings: string[];
  source: {
    fileName: string;
    mimeType: string;
    characterCount: number;
  };
}

const SECTION_ALIASES: Record<string, string[]> = {
  summary: ['summary', 'professional summary', 'profile', 'objective'],
  skills: ['skills', 'technical skills', 'core competencies', 'technologies', 'tools'],
  experience: ['experience', 'work experience', 'professional experience', 'employment', 'employment history', 'work history'],
  education: ['education', 'academic background', 'academic experience'],
  projects: ['projects', 'selected projects', 'technical projects', 'academic projects', 'project experience'],
  courses: ['coursework', 'relevant coursework', 'relevant courses'],
  certifications: ['certifications', 'certificates', 'licenses and certifications'],
};

const TITLE_TERMS = /\b(engineer|developer|designer|analyst|manager|intern|consultant|specialist|coordinator|assistant|director|lead|architect|administrator|scientist|researcher|technician|teacher|professor|associate|representative|supervisor|officer)\b/i;
const COMPANY_TERMS = /\b(inc\.?|llc|ltd\.?|corp\.?|corporation|company|technologies|technology|systems|solutions|group|labs?|studio|university|college|institute|hospital|bank|department)\b/i;
const SCHOOL_TERMS = /\b(university|college|institute|school|academy|polytechnic)\b/i;
const DEGREE_TERMS = /\b(bachelor|master|associate|doctor|ph\.?d|b\.?s\.?|b\.?a\.?|m\.?s\.?|m\.?a\.?|mba|degree|diploma|minor|major)\b/i;
const DATE_RANGE = /\b((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(?:19|20)\d{2}\s*(?:-|–|—|to)\s*(?:(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?(?:19|20)\d{2}|present|current)\b/i;

const SKILL_GROUPS: Record<string, string[]> = {
  javascript: ['TypeScript', 'React', 'Node.js', 'Express', 'Next.js', 'HTML', 'CSS', 'REST APIs'],
  typescript: ['JavaScript', 'React', 'Node.js', 'Next.js', 'Express', 'REST APIs'],
  react: ['TypeScript', 'JavaScript', 'Next.js', 'HTML', 'CSS', 'Jest', 'Playwright'],
  python: ['Django', 'Flask', 'FastAPI', 'Pandas', 'NumPy', 'Pytest', 'SQL'],
  java: ['Spring Boot', 'JUnit', 'Maven', 'Gradle', 'REST APIs', 'SQL'],
  'c#': ['.NET', 'ASP.NET', 'Entity Framework', 'SQL', 'Azure'],
  sql: ['PostgreSQL', 'MySQL', 'Data Modeling', 'ETL', 'Database Design'],
  postgresql: ['SQL', 'Database Design', 'Data Modeling', 'Drizzle ORM'],
  aws: ['Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Cloud Computing'],
  azure: ['Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Cloud Computing'],
  docker: ['Kubernetes', 'CI/CD', 'AWS', 'Azure', 'Linux'],
  'machine learning': ['Python', 'Pandas', 'NumPy', 'scikit-learn', 'TensorFlow', 'Data Analysis'],
  'data analysis': ['Python', 'SQL', 'Pandas', 'Excel', 'Tableau', 'Power BI'],
  figma: ['UI/UX Design', 'Prototyping', 'Design Systems', 'User Research'],
  'project management': ['Agile', 'Scrum', 'Jira', 'Stakeholder Management', 'Risk Management'],
  sales: ['CRM', 'Salesforce', 'Lead Generation', 'Account Management', 'Customer Success'],
  marketing: ['SEO', 'Content Strategy', 'Google Analytics', 'Social Media', 'Market Research'],
};

const KNOWN_SKILLS = [...new Set([
  ...Object.keys(SKILL_GROUPS),
  ...Object.values(SKILL_GROUPS).flat(),
  'C', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'R', 'MATLAB',
  'MongoDB', 'Redis', 'GraphQL', 'Git', 'GitHub', 'Linux', 'Bash', 'PowerShell',
  'Selenium', 'Cypress', 'Unit Testing', 'Integration Testing', 'API Testing',
  'Communication', 'Leadership', 'Problem Solving', 'Customer Service', 'Microsoft Office',
])];

function compact(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function normalizedHeading(value: string) {
  return compact(value).replace(/[:|]+$/, '').toLowerCase();
}

function sectionName(line: string) {
  const normalized = normalizedHeading(line);
  if (normalized.length > 40) return null;
  return Object.entries(SECTION_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] ?? null;
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = compact(value).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(compact);
}

function splitSections(text: string) {
  const sections: Record<string, string[]> = { header: [] };
  let current = 'header';
  text.split(/\r?\n/).forEach((rawLine) => {
    const line = compact(rawLine);
    const heading = line ? sectionName(line) : null;
    if (heading) {
      current = heading;
      sections[current] ??= [];
      return;
    }
    sections[current] ??= [];
    sections[current]!.push(line);
  });
  return sections;
}

function extractUrl(text: string, hostname: string) {
  const escaped = hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?[^\\s|,;]*${escaped}[^\\s|,;]*`, 'i'));
  if (!match) return undefined;
  return match[0].startsWith('http') ? match[0] : `https://${match[0]}`;
}

function extractContact(sections: Record<string, string[]>) {
  const header = (sections.header ?? []).filter(Boolean).slice(0, 16);
  const headerText = header.join(' | ');
  const email = headerText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = headerText.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}/)?.[0];
  const fullName = header.find((line) => (
    /^[A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+){1,4}$/.test(line)
    && !TITLE_TERMS.test(line)
  ));
  const location = header.find((line) => (
    /\b[A-Z][a-zA-Z .'-]+,\s*(?:[A-Z]{2}|[A-Z][a-zA-Z .'-]+)(?:,\s*[A-Z][a-zA-Z .'-]+)?\b/.test(line)
    && !line.includes('@')
  ));
  const linkedinUrl = extractUrl(headerText, 'linkedin.com');
  const githubUrl = extractUrl(headerText, 'github.com');
  const portfolioUrl = headerText.match(/https?:\/\/(?![^\s]*(?:linkedin|github)\.com)[^\s|,;]+/i)?.[0];

  return { fullName, email, phone, location, linkedinUrl, githubUrl, portfolioUrl };
}

function splitList(lines: string[]) {
  return dedupe(lines.flatMap((line) => line
    .replace(/^[•·▪◦*-]+\s*/, '')
    .split(/\s*[|,;•·▪◦]\s*/)
    .map(compact)
    .filter((value) => value.length >= 2 && value.length <= 60)));
}

function extractSkills(text: string, sections: Record<string, string[]>) {
  const explicit = splitList(sections.skills ?? []).map((value) => value.replace(/^[^:]{2,24}:\s*/, ''));
  const lowerText = text.toLowerCase();
  const detected = KNOWN_SKILLS.filter((skill) => {
    const normalized = skill.toLowerCase();
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i').test(lowerText);
  });
  return dedupe([...explicit, ...detected]).slice(0, 80);
}

function parseDateRange(value: string) {
  const match = value.match(DATE_RANGE)?.[0];
  if (!match) return {};
  const [startDate, endDate] = match.split(/\s*(?:-|–|—|to)\s*/i);
  return { startDate: compact(startDate ?? ''), endDate: compact(endDate ?? '') };
}

function blocks(lines: string[]) {
  const output: string[][] = [];
  let current: string[] = [];
  lines.forEach((line) => {
    if (!line) {
      if (current.length > 0) output.push(current);
      current = [];
      return;
    }
    current.push(line);
  });
  if (current.length > 0) output.push(current);
  return output;
}

function extractEducation(lines: string[]) {
  const entries: EducationEntry[] = [];
  const candidates = blocks(lines);
  if (candidates.length <= 1) {
    lines.forEach((line, index) => {
      if (SCHOOL_TERMS.test(line)) candidates.push(lines.slice(index, Math.min(index + 4, lines.length)).filter(Boolean));
    });
  }

  candidates.forEach((block) => {
    const school = block.find((line) => SCHOOL_TERMS.test(line));
    const degree = block.find((line) => DEGREE_TERMS.test(line));
    if (!school && !degree) return;
    const dateLine = block.find((line) => DATE_RANGE.test(line) || /\b(?:19|20)\d{2}\b/.test(line));
    const field = degree?.match(/(?:in|of)\s+([^,|]+)/i)?.[1]?.trim() ?? '';
    const dates = dateLine ? parseDateRange(dateLine) : {};
    entries.push({
      school: school ?? block[0] ?? '',
      degree: degree ?? '',
      field,
      ...dates,
      notes: block.filter((line) => line !== school && line !== degree && line !== dateLine).join(' | '),
    });
  });
  return entries.filter((entry) => entry.school || entry.degree).slice(0, 8);
}

function extractWork(lines: string[]) {
  const entries: WorkHistoryEntry[] = [];
  let candidates = blocks(lines).filter((block) => block.some((line) => DATE_RANGE.test(line)));
  if (candidates.length === 0) {
    const anchors = lines.map((line, index) => DATE_RANGE.test(line) ? index : -1).filter((index) => index >= 0);
    candidates = anchors.map((index, position) => lines.slice(Math.max(0, index - 2), anchors[position + 1] ?? lines.length).filter(Boolean));
  }

  candidates.forEach((block) => {
    const dateLine = block.find((line) => DATE_RANGE.test(line));
    if (!dateLine) return;
    const dateIndex = block.indexOf(dateLine);
    const headingLines = block.slice(0, dateIndex).filter((line) => !/^[-•]/.test(line)).slice(-3);
    const titleLine = headingLines.find((line) => TITLE_TERMS.test(line));
    const companyLine = headingLines.find((line) => line !== titleLine && COMPANY_TERMS.test(line))
      ?? headingLines.find((line) => line !== titleLine);
    const title = titleLine ?? headingLines[0] ?? '';
    const company = companyLine ?? headingLines[1] ?? '';
    const highlights = block.slice(dateIndex + 1)
      .map((line) => line.replace(/^[•·▪◦*-]+\s*/, ''))
      .filter((line) => line.length > 15);
    const dates = parseDateRange(dateLine);
    entries.push({
      company,
      title,
      ...dates,
      current: /present|current/i.test(dates.endDate ?? ''),
      highlights: highlights.slice(0, 12),
    });
  });
  return entries.filter((entry) => entry.company || entry.title).slice(0, 12);
}

function extractProjects(lines: string[]) {
  return blocks(lines).map((block): ProjectEntry | null => {
    const name = block.find((line) => !/^[-•]/.test(line) && !DATE_RANGE.test(line));
    if (!name) return null;
    const url = block.join(' ').match(/https?:\/\/[^\s|,;]+/)?.[0];
    const description = block
      .filter((line) => line !== name && line !== url)
      .map((line) => line.replace(/^[•·▪◦*-]+\s*/, ''))
      .join(' ');
    return {
      name,
      ...(url ? { url } : {}),
      ...(description ? { description } : {}),
    };
  }).filter((entry): entry is ProjectEntry => Boolean(entry)).slice(0, 12);
}

function extractCertifications(lines: string[]) {
  return lines.filter(Boolean).map((line): CertificationEntry => {
    const [name, issuer] = line.split(/\s*[|,-]\s*/, 2);
    return { name: compact(name ?? line), issuer: compact(issuer ?? '') };
  }).filter((entry) => entry.name.length > 2).slice(0, 12);
}

export function suggestRelatedSkills(skills: string[], query = '') {
  const selected = new Set(skills.map((skill) => skill.toLowerCase()));
  const normalizedQuery = query.trim().toLowerCase();
  const related = skills.flatMap((skill) => SKILL_GROUPS[skill.toLowerCase()] ?? []);
  const matching = normalizedQuery.length >= 2
    ? KNOWN_SKILLS.filter((skill) => skill.toLowerCase().includes(normalizedQuery))
    : [];
  return dedupe([...matching, ...related])
    .filter((skill) => !selected.has(skill.toLowerCase()))
    .slice(0, 24);
}

function targetRoleSuggestions(workHistory: WorkHistoryEntry[]) {
  return dedupe(workHistory.map((entry) => entry.title).filter((title) => TITLE_TERMS.test(title))).slice(0, 8);
}

export function parseResumeText(text: string, fileName = 'resume.txt', mimeType = 'text/plain'): ResumeParseResult {
  const normalizedText = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const sections = splitSections(normalizedText);
  const contact = extractContact(sections);
  const skills = extractSkills(normalizedText, sections);
  const educationHistory = extractEducation(sections.education ?? []);
  const workHistory = extractWork(sections.experience ?? []);
  const projectHistory = extractProjects(sections.projects ?? []);
  const relevantCourses = splitList(sections.courses ?? []);
  const certifications = extractCertifications(sections.certifications ?? []);
  const warnings: string[] = [];

  if (!contact.fullName) warnings.push('Name was not confidently detected.');
  if (!contact.email) warnings.push('Email was not detected.');
  if (workHistory.length === 0 && (sections.experience?.filter(Boolean).length ?? 0) > 0) {
    warnings.push('Experience text was found but could not be separated reliably. Review it manually.');
  }
  if (educationHistory.length === 0 && (sections.education?.filter(Boolean).length ?? 0) > 0) {
    warnings.push('Education text was found but could not be separated reliably. Review it manually.');
  }

  const contactDraft = Object.fromEntries(
    Object.entries(contact).filter(([, value]) => Boolean(value)),
  ) as Partial<ResumeProfileDraft>;

  return {
    draft: {
      ...contactDraft,
      education: (sections.education ?? []).filter(Boolean).join('\n'),
      workExperience: (sections.experience ?? []).filter(Boolean).join('\n'),
      skills,
      relevantCourses,
      educationHistory,
      workHistory,
      projectHistory,
      certifications,
    },
    suggestedSkills: suggestRelatedSkills(skills),
    targetRoleSuggestions: targetRoleSuggestions(workHistory),
    warnings,
    source: { fileName, mimeType, characterCount: normalizedText.length },
  };
}

export async function parseResumeFile(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  let text = '';
  if (extension === '.pdf' || file.mimetype === 'application/pdf') {
    text = (await pdfParse(file.buffer)).text;
  } else if (extension === '.docx' || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
  } else if (extension === '.txt' || file.mimetype === 'text/plain') {
    text = file.buffer.toString('utf8');
  } else {
    throw new Error('Unsupported resume format. Upload a PDF, DOCX, or TXT file.');
  }

  if (text.trim().length < 40) {
    throw new Error('The resume did not contain enough readable text. Scanned PDFs need OCR before import.');
  }
  return parseResumeText(text, file.originalname, file.mimetype);
}

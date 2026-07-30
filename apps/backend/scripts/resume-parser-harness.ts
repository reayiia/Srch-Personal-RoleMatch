import assert from 'node:assert/strict';
import { parseResumeText } from '../src/profile/resumeParser.js';

const sample = `
Alex Morgan
Boston, MA | alex@example.com | (617) 555-0182
https://linkedin.com/in/alex-morgan | https://github.com/alexm

TECHNICAL SKILLS
JavaScript, TypeScript, React, Node.js, PostgreSQL, Git

EXPERIENCE
Software Engineer
Example Systems, Boston, MA
June 2023 - Present
- Built React and TypeScript workflows used by internal teams.
- Designed REST APIs backed by PostgreSQL.

EDUCATION
Example Institute of Technology
Bachelor of Science in Computer Science
September 2019 - May 2023

PROJECTS
Application Tracker
- Built a job tracking application with React and Node.js.

RELEVANT COURSEWORK
Algorithms, Database Systems, Software Engineering
`;

const result = parseResumeText(sample, 'alex-resume.txt', 'text/plain');
assert.equal(result.draft.fullName, 'Alex Morgan');
assert.equal(result.draft.email, 'alex@example.com');
assert.match(result.draft.phone ?? '', /617/);
assert.ok(result.draft.skills.some((skill) => skill.toLowerCase() === 'typescript'));
assert.ok(result.draft.skills.some((skill) => skill.toLowerCase() === 'postgresql'));
assert.equal(result.draft.workHistory[0]?.title, 'Software Engineer');
assert.equal(result.draft.workHistory[0]?.company, 'Example Systems, Boston, MA');
assert.equal(result.draft.educationHistory[0]?.school, 'Example Institute of Technology');
assert.ok(result.draft.relevantCourses.includes('Algorithms'));
assert.ok(result.suggestedSkills.includes('Next.js'));

console.log('Resume parser harness passed.');

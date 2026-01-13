#!/usr/bin/env npx tsx
/**
 * Import user stories from a PRD JSON file as tasks
 */
import { TaskRepository, type CreateTaskInput, type TaskType, type EffortLevel } from '../src/queue/task.js';
import { initDatabase } from '../src/db/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Get PRD path from arguments
const prdPath = process.argv[2];
if (!prdPath) {
  console.error('Usage: npx tsx scripts/import-prd.ts <prd-file.json>');
  process.exit(1);
}

// Read the PRD
const fullPath = path.resolve(prdPath);
if (!fs.existsSync(fullPath)) {
  console.error(`PRD file not found: ${fullPath}`);
  process.exit(1);
}

const prd = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
console.log(`Importing ${prd.userStories.length} stories from: ${prd.project}`);

// Initialize database
const db = initDatabase();

// Get metaralph project ID
interface ProjectRow {
  id: string;
  name: string;
}
const projects = db.prepare('SELECT * FROM projects WHERE name = ?').all('metaralph') as ProjectRow[];
if (projects.length === 0) {
  console.error('MetaRalph project not found in registry. Run: metaralph projects add .');
  db.close();
  process.exit(1);
}
const projectId = projects[0].id;
console.log(`Target project: ${projectId}`);

// Map titles to task types
function inferTaskType(title: string): TaskType {
  const lower = title.toLowerCase();
  if (lower.includes('test') || lower.includes('e2e') || lower.includes('qa')) return 'test';
  if (lower.includes('doc') || lower.includes('changelog') || lower.includes('release notes')) return 'docs';
  if (lower.includes('refactor') || lower.includes('update')) return 'refactor';
  return 'feature';
}

// Map priority to effort
function inferEffort(priority: number): EffortLevel {
  if (priority <= 3) return 'small';
  if (priority <= 10) return 'medium';
  return 'large';
}

// Import each user story as a task
let imported = 0;
for (const story of prd.userStories) {
  const input: CreateTaskInput = {
    projectId,
    type: inferTaskType(story.title),
    title: story.title,
    source: 'analysis',
    estimatedEffort: inferEffort(story.priority),
    description: story.description,
    prdJson: JSON.stringify({
      project: prd.project,
      branchName: prd.branchName,
      description: story.description,
      userStories: [story],
    }, null, 2),
  };

  const task = TaskRepository.create(input, db);
  console.log(`[${story.id}] ${story.title}`);
  imported++;
}

db.close();
console.log(`\nDone! Imported ${imported} tasks.`);
console.log('Run "metaralph queue" to see them.');

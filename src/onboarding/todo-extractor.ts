/**
 * TODO Extractor - Extracts TODO/FIXME/XXX/HACK comments from codebases
 *
 * Scans project files for common comment tags that indicate work to be done.
 * Categorizes findings by type and estimates effort.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskType, EffortLevel } from '../queue/task.js';
import type { ImprovementOpportunity } from './analyzer.js';

/**
 * Tags to search for in comments
 */
const TODO_TAGS = ['TODO', 'FIXME', 'XXX', 'HACK'] as const;

type TodoTag = (typeof TODO_TAGS)[number];

/**
 * A TODO comment found in the codebase
 */
export interface TodoComment {
  tag: TodoTag;
  content: string;
  file: string;
  line: number;
}

/**
 * File extensions to scan for TODOs
 */
const SCANNABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.vue',
  '.svelte',
  '.md',
  '.yaml',
  '.yml',
  '.sh',
  '.bash',
]);

/**
 * Directories to skip when scanning
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  'vendor',
  'target',
  'coverage',
  '.coverage',
  '.nyc_output',
  '.turbo',
  '.vercel',
]);

/**
 * Maximum file size to scan (1MB)
 */
const MAX_FILE_SIZE = 1024 * 1024;

/**
 * Recursively get all files in a directory
 */
function getAllFiles(dirPath: string, files: string[] = []): string[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          getAllFiles(fullPath, files);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SCANNABLE_EXTENSIONS.has(ext)) {
          // Check file size
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= MAX_FILE_SIZE) {
              files.push(fullPath);
            }
          } catch {
            // Skip files we can't stat
          }
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return files;
}

/**
 * Extract TODO comments from a file
 */
function extractFromFile(filePath: string): TodoComment[] {
  const comments: TodoComment[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    // Regex to match TODO/FIXME/XXX/HACK comments
    // Matches: // TODO: message, # FIXME message, /* XXX: message, etc.
    const todoRegex = /(?:\/\/|#|\/\*|\*|<!--)\s*(TODO|FIXME|XXX|HACK)[:\s]?\s*(.*)$/i;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(todoRegex);

      if (match) {
        const tag = match[1].toUpperCase() as TodoTag;
        let content = match[2].trim();

        // Clean up trailing comment markers
        content = content.replace(/\*\/|-->$/, '').trim();

        if (content) {
          comments.push({
            tag,
            content,
            file: filePath,
            line: i + 1, // 1-indexed
          });
        }
      }
    }
  } catch {
    // Skip files we can't read
  }

  return comments;
}

/**
 * Categorize a TODO tag to a task type
 */
function tagToTaskType(tag: TodoTag): TaskType {
  switch (tag) {
    case 'FIXME':
      return 'bug_fix';
    case 'HACK':
      return 'refactor';
    case 'TODO':
    case 'XXX':
    default:
      return 'feature';
  }
}

/**
 * Estimate effort based on TODO content
 */
function estimateEffort(content: string): EffortLevel {
  const lowerContent = content.toLowerCase();

  // Keywords indicating larger effort
  const largeKeywords = ['refactor', 'rewrite', 'redesign', 'architecture', 'migrate'];
  const mediumKeywords = ['implement', 'add', 'create', 'build', 'integrate'];
  const quickKeywords = ['fix', 'update', 'change', 'rename', 'remove', 'delete', 'typo'];

  if (largeKeywords.some((kw) => lowerContent.includes(kw))) {
    return 'large';
  }
  if (mediumKeywords.some((kw) => lowerContent.includes(kw))) {
    return 'medium';
  }
  if (quickKeywords.some((kw) => lowerContent.includes(kw))) {
    return 'quick_win';
  }

  // Default to small for unrecognized patterns
  return 'small';
}

/**
 * Determine severity based on tag
 */
function tagToSeverity(tag: TodoTag): 'low' | 'medium' | 'high' {
  switch (tag) {
    case 'FIXME':
      return 'high';
    case 'HACK':
      return 'medium';
    case 'XXX':
      return 'medium';
    case 'TODO':
    default:
      return 'low';
  }
}

/**
 * Convert a TODO comment to an ImprovementOpportunity
 */
function todoToOpportunity(todo: TodoComment, projectPath: string): ImprovementOpportunity {
  const relativePath = path.relative(projectPath, todo.file);

  return {
    type: 'todo_comment',
    title: `${todo.tag}: ${todo.content.substring(0, 60)}${todo.content.length > 60 ? '...' : ''}`,
    description: `${todo.tag} comment in ${relativePath}:${todo.line}: ${todo.content}`,
    file: relativePath,
    line: todo.line,
    severity: tagToSeverity(todo.tag),
    suggestedTaskType: tagToTaskType(todo.tag),
    suggestedEffort: estimateEffort(todo.content),
  };
}

/**
 * TodoExtractor - Main extractor object
 *
 * Extracts TODO/FIXME/XXX/HACK comments from a project directory.
 */
export const TodoExtractor = {
  /**
   * Extract all TODO comments from a project
   *
   * @param projectPath - Path to the project to scan
   * @returns Array of TodoComment objects
   */
  extract(projectPath: string): TodoComment[] {
    const files = getAllFiles(projectPath);
    const allComments: TodoComment[] = [];

    for (const file of files) {
      const comments = extractFromFile(file);
      allComments.push(...comments);
    }

    return allComments;
  },

  /**
   * Extract TODOs and convert them to improvement opportunities
   *
   * @param projectPath - Path to the project to scan
   * @returns Array of ImprovementOpportunity objects
   */
  extractAsOpportunities(projectPath: string): ImprovementOpportunity[] {
    const todos = this.extract(projectPath);
    return todos.map((todo) => todoToOpportunity(todo, projectPath));
  },

  /**
   * Get summary statistics for TODOs in a project
   *
   * @param projectPath - Path to the project to scan
   * @returns Summary object with counts by tag
   */
  getSummary(projectPath: string): Record<TodoTag, number> & { total: number } {
    const todos = this.extract(projectPath);

    const summary: Record<TodoTag, number> & { total: number } = {
      TODO: 0,
      FIXME: 0,
      XXX: 0,
      HACK: 0,
      total: 0,
    };

    for (const todo of todos) {
      summary[todo.tag]++;
      summary.total++;
    }

    return summary;
  },
};

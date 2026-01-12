/**
 * Project Group Registry - Manages groups for related repositories
 *
 * Allows users to bundle related projects (e.g., microservices + API)
 * so they can be managed together as a single unit.
 */

import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { initDatabase, type DatabaseInstance } from '../db/index.js';
import { addProject, getProjectByPath, type Project } from './index.js';

/**
 * Represents a project group in MetaRalph
 */
export interface ProjectGroup {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Represents a group with its associated projects
 */
export interface GroupWithProjects extends ProjectGroup {
  projects: Project[];
}

/**
 * Result of a group operation
 */
export interface GroupResult {
  success: boolean;
  message: string;
  group?: ProjectGroup;
}

/**
 * Create a new project group
 *
 * @param name - Name of the group
 * @param description - Optional description of the group
 * @param db - Optional database instance (creates one if not provided)
 * @returns Result of the create operation
 */
export function createGroup(name: string, description?: string, db?: DatabaseInstance): GroupResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Check if group name already exists
    const existing = database.prepare('SELECT * FROM project_groups WHERE name = ?').get(name) as ProjectGroup | undefined;
    if (existing) {
      return {
        success: false,
        message: `Group already exists: ${name}`,
        group: existing,
      };
    }

    // Create the group
    const id = uuidv4();
    const now = new Date().toISOString();

    database.prepare(`
      INSERT INTO project_groups (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, description ?? null, now, now);

    const group: ProjectGroup = {
      id,
      name,
      description: description ?? null,
      created_at: now,
      updated_at: now,
    };

    return {
      success: true,
      message: `Group created: ${name}`,
      group,
    };
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Get a group by name
 *
 * @param name - Name of the group
 * @param db - Optional database instance (creates one if not provided)
 * @returns The group or undefined if not found
 */
export function getGroupByName(name: string, db?: DatabaseInstance): ProjectGroup | undefined {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    return database.prepare('SELECT * FROM project_groups WHERE name = ?').get(name) as ProjectGroup | undefined;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Get a group by ID
 *
 * @param id - ID of the group
 * @param db - Optional database instance (creates one if not provided)
 * @returns The group or undefined if not found
 */
export function getGroupById(id: string, db?: DatabaseInstance): ProjectGroup | undefined {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    return database.prepare('SELECT * FROM project_groups WHERE id = ?').get(id) as ProjectGroup | undefined;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Add a project to a group
 *
 * If the project is not already registered, it will be added first.
 *
 * @param groupIdentifier - Name or ID of the group
 * @param projectPath - Path to the project
 * @param db - Optional database instance (creates one if not provided)
 * @returns Result of the operation
 */
export function addToGroup(groupIdentifier: string, projectPath: string, db?: DatabaseInstance): GroupResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Find the group by name or ID
    let group = database.prepare('SELECT * FROM project_groups WHERE name = ?').get(groupIdentifier) as ProjectGroup | undefined;
    if (!group) {
      group = database.prepare('SELECT * FROM project_groups WHERE id = ?').get(groupIdentifier) as ProjectGroup | undefined;
    }

    if (!group) {
      return {
        success: false,
        message: `Group not found: ${groupIdentifier}`,
      };
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(projectPath);

    // Check if project is already registered
    let project = getProjectByPath(absolutePath, database);

    // If not registered, add it first
    if (!project) {
      const addResult = addProject(absolutePath, database);
      if (!addResult.success) {
        return {
          success: false,
          message: addResult.message,
        };
      }
      project = addResult.project;
    }

    if (!project) {
      return {
        success: false,
        message: `Failed to find or create project at: ${absolutePath}`,
      };
    }

    // Check if project is already in this group
    if (project.group_id === group.id) {
      return {
        success: false,
        message: `Project ${project.name} is already in group ${group.name}`,
        group,
      };
    }

    // Update project's group_id
    const now = new Date().toISOString();
    database.prepare(`
      UPDATE projects SET group_id = ?, updated_at = ?
      WHERE id = ?
    `).run(group.id, now, project.id);

    return {
      success: true,
      message: `Added ${project.name} to group ${group.name}`,
      group,
    };
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Remove a project from its group
 *
 * @param projectPath - Path to the project
 * @param db - Optional database instance (creates one if not provided)
 * @returns Result of the operation
 */
export function removeFromGroup(projectPath: string, db?: DatabaseInstance): GroupResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Resolve to absolute path
    const absolutePath = path.resolve(projectPath);

    // Find the project
    const project = getProjectByPath(absolutePath, database);

    if (!project) {
      return {
        success: false,
        message: `Project not found: ${absolutePath}`,
      };
    }

    if (!project.group_id) {
      return {
        success: false,
        message: `Project ${project.name} is not in any group`,
      };
    }

    // Get the group name for the message
    const group = database.prepare('SELECT * FROM project_groups WHERE id = ?').get(project.group_id) as ProjectGroup | undefined;
    const groupName = group?.name ?? 'unknown';

    // Remove from group
    const now = new Date().toISOString();
    database.prepare(`
      UPDATE projects SET group_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, project.id);

    return {
      success: true,
      message: `Removed ${project.name} from group ${groupName}`,
      group,
    };
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * List all groups with their projects
 *
 * @param db - Optional database instance (creates one if not provided)
 * @returns Array of all groups with their projects
 */
export function listGroups(db?: DatabaseInstance): GroupWithProjects[] {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Get all groups
    const groups = database.prepare(`
      SELECT * FROM project_groups
      ORDER BY name ASC
    `).all() as ProjectGroup[];

    // Get projects for each group
    const groupsWithProjects: GroupWithProjects[] = groups.map((group) => {
      const projects = database.prepare(`
        SELECT * FROM projects
        WHERE group_id = ?
        ORDER BY name ASC
      `).all(group.id) as Project[];

      return {
        ...group,
        projects,
      };
    });

    return groupsWithProjects;
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

/**
 * Delete a group
 *
 * Projects in the group will have their group_id set to NULL (due to foreign key ON DELETE SET NULL)
 *
 * @param groupIdentifier - Name or ID of the group
 * @param db - Optional database instance (creates one if not provided)
 * @returns Result of the operation
 */
export function deleteGroup(groupIdentifier: string, db?: DatabaseInstance): GroupResult {
  const shouldCloseDb = !db;
  const database = db ?? initDatabase();

  try {
    // Find the group by name or ID
    let group = database.prepare('SELECT * FROM project_groups WHERE name = ?').get(groupIdentifier) as ProjectGroup | undefined;
    if (!group) {
      group = database.prepare('SELECT * FROM project_groups WHERE id = ?').get(groupIdentifier) as ProjectGroup | undefined;
    }

    if (!group) {
      return {
        success: false,
        message: `Group not found: ${groupIdentifier}`,
      };
    }

    // Delete the group (projects will be unlinked due to ON DELETE SET NULL)
    database.prepare('DELETE FROM project_groups WHERE id = ?').run(group.id);

    return {
      success: true,
      message: `Group deleted: ${group.name}`,
      group,
    };
  } finally {
    if (shouldCloseDb) {
      database.close();
    }
  }
}

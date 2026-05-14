import { join } from 'path';
import { homedir } from 'os';
import {
  existsSync,
  mkdirSync,
  cpSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from 'fs';

const PROJECT_ROOT = process.cwd();

// Increment this to force-refresh all workspace files (prompts, skills, commands)
const WORKSPACE_VERSION = 2;

// Only these commands should be available in agent chat
const ALLOWED_COMMANDS = [
  'add_modules.md',
  'dev-server.md',
  'iw.md',
  'update-app.md',
  'update-workspace.md',
];

/**
 * Get the agent workspace directory (~/Documents/b0t)
 */
export function getAgentWorkspaceDir(): string {
  const homeDir = homedir();
  return join(homeDir, 'Documents', 'b0t');
}

/**
 * Initialize agent workspace by copying necessary folders
 * Copies: scripts/, plans/, .claude/, workflows/
 */
export function initializeAgentWorkspace(): void {
  const workspaceDir = getAgentWorkspaceDir();

  // Ensure workspace directory exists
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
    console.log(`📁 Created agent workspace: ${workspaceDir}`);
  }

  // Check workspace version to determine if we need to refresh files
  const versionFile = join(workspaceDir, '.workspace-version');
  let currentVersion = 0;
  if (existsSync(versionFile)) {
    try {
      currentVersion = parseInt(readFileSync(versionFile, 'utf-8').trim(), 10) || 0;
    } catch {
      currentVersion = 0;
    }
  }
  const needsRefresh = currentVersion < WORKSPACE_VERSION;

  // Create plans directory with example plans
  const plansDir = join(workspaceDir, 'plans');
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
    const srcPlansDir = join(PROJECT_ROOT, 'plans');
    if (existsSync(srcPlansDir)) {
      try {
        cpSync(srcPlansDir, plansDir, { recursive: true });
        console.log(`📋 Copied example plans to workspace`);
      } catch (error) {
        console.error('Failed to copy plans:', error);
      }
    }
  }

  // Create workflows directory for generated JSON
  const workflowsDir = join(workspaceDir, 'workflows');
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true });
    console.log(`📁 Created workflows directory in workspace`);
  }

  // Copy only allowed commands from .claude/commands (refresh on version bump)
  const srcCommandsDir = join(PROJECT_ROOT, '.claude', 'commands');
  const destCommandsDir = join(workspaceDir, '.claude', 'commands');

  if (existsSync(srcCommandsDir)) {
    if (!existsSync(destCommandsDir)) {
      mkdirSync(destCommandsDir, { recursive: true });
    }

    for (const cmdFile of ALLOWED_COMMANDS) {
      const srcFile = join(srcCommandsDir, cmdFile);
      const destFile = join(destCommandsDir, cmdFile);

      if (existsSync(srcFile) && (needsRefresh || !existsSync(destFile))) {
        try {
          copyFileSync(srcFile, destFile);
          console.log(`📋 Copied command: ${cmdFile}`);
        } catch (error) {
          console.error(`Failed to copy ${cmdFile}:`, error);
        }
      }
    }
  }

  // Copy prompts directory (refresh on version bump)
  const srcPromptsDir = join(PROJECT_ROOT, '.claude', 'prompts');
  const destPromptsDir = join(workspaceDir, '.claude', 'prompts');

  if (existsSync(srcPromptsDir)) {
    if (needsRefresh || !existsSync(destPromptsDir)) {
      try {
        mkdirSync(destPromptsDir, { recursive: true });
        cpSync(srcPromptsDir, destPromptsDir, { recursive: true });
        console.log(`📋 Copied prompts to agent workspace`);
      } catch (error) {
        console.error('Failed to copy prompts:', error);
      }
    }
  }

  // Copy workspace-specific skills (always refresh on version bump)
  const srcSkillsDir = join(PROJECT_ROOT, '.claude', 'skills-workspace');
  const destSkillsDir = join(workspaceDir, '.claude', 'skills');

  if (existsSync(srcSkillsDir)) {
    if (needsRefresh || !existsSync(destSkillsDir) || readdirSync(destSkillsDir).length === 0) {
      try {
        cpSync(srcSkillsDir, destSkillsDir, { recursive: true });
        console.log(`📋 Copied workspace skills to agent workspace`);
      } catch (error) {
        console.error('Failed to copy skills:', error);
      }
    }
  }

  // Write updated workspace version
  if (needsRefresh) {
    writeFileSync(versionFile, String(WORKSPACE_VERSION));
    console.log(`🔄 Workspace refreshed to version ${WORKSPACE_VERSION}`);
  }

  // Create README explaining the workspace
  const readmePath = join(workspaceDir, 'README.md');
  if (!existsSync(readmePath) || needsRefresh) {
    const readme = `# b0t Agent Workspace

This directory is used by the b0t Build agent.

## Directory Structure

- \`plans/\` - YAML workflow plans (examples and agent-created)
- \`workflows/\` - Generated workflow JSON files (agent creates these)
- \`.claude/commands/\` - Slash commands (/iw, /add-modules, /update-app, /dev-server)
- \`.claude/skills/\` - AI agent skills (workflow-generator, workflow-import, agent-generator)
- \`.claude/prompts/\` - System prompts (build-agent)

## How It Works

The agent creates workflow plans (YAML) in the plans/ folder, then uses the b0t API
to build and import them directly to your application. No manual setup required.
`;
    writeFileSync(readmePath, readme);
    console.log(`📝 Created README in workspace`);
  }
}

/**
 * Check if agent workspace is initialized
 */
export function isAgentWorkspaceInitialized(): boolean {
  const workspaceDir = getAgentWorkspaceDir();

  if (!existsSync(workspaceDir)) {
    return false;
  }

  // Check if key folders exist
  const commandsDir = join(workspaceDir, '.claude', 'commands');
  const skillsDir = join(workspaceDir, '.claude', 'skills');

  return existsSync(commandsDir) && existsSync(skillsDir);
}

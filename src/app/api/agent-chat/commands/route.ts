import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getAgentWorkspaceDir } from '@/lib/agent-workspace';
import { logger } from '@/lib/logger';
import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAgentChatRateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

const BUILT_IN_COMMANDS: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Clear conversation history and start fresh',
    argumentHint: '',
  },
  {
    name: 'compact',
    description: 'Compact conversation history to reduce token usage',
    argumentHint: '',
  },
  {
    name: 'remember',
    description: 'Store a fact in agent memory',
    argumentHint: '[category] [subject]: [content]',
  },
  {
    name: 'recall',
    description: 'Search agent memory for relevant facts',
    argumentHint: '[query]',
  },
  {
    name: 'forget',
    description: 'Delete a fact from agent memory',
    argumentHint: '[fact-id]',
  },
];

function parseFrontmatter(content: string): { description: string; argumentHint: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return { description: '', argumentHint: '' };
  }

  const frontmatter = frontmatterMatch[1];
  const descMatch = frontmatter.match(/description:\s*(.+)/);
  const argMatch = frontmatter.match(/argument-hint:\s*(.+)/);

  return {
    description: descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, '') : '',
    argumentHint: argMatch ? argMatch[1].trim().replace(/^["']|["']$/g, '') : '',
  };
}

export async function GET(request: NextRequest) {
  try {
    // Rate limit check
    const rateLimitResult = await checkAgentChatRateLimit(request);
    if (rateLimitResult) return rateLimitResult;

    const session = await auth();
    if (!session?.user?.id) {
      return new Response('Unauthorized', { status: 401 });
    }

    const workspaceDir = getAgentWorkspaceDir();
    const commandsDir = join(workspaceDir, '.claude', 'commands');

    const commands: SlashCommand[] = [...BUILT_IN_COMMANDS];

    // Load custom commands from .claude/commands
    if (existsSync(commandsDir)) {
      const files = readdirSync(commandsDir);

      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = join(commandsDir, file);
          const content = readFileSync(filePath, 'utf-8');
          const { description, argumentHint } = parseFrontmatter(content);

          commands.push({
            name: file.replace('.md', ''),
            description,
            argumentHint,
          });
        }
      }
    }

    return NextResponse.json({ commands });
  } catch (error) {
    logger.error({ error }, 'Error loading commands');
    return NextResponse.json({ commands: BUILT_IN_COMMANDS });
  }
}

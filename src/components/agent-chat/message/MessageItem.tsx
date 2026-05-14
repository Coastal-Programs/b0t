'use client';

import React, { memo } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { ToolDisplay } from './ToolDisplay';
import { WorkflowCreatedCard } from './WorkflowCreatedCard';

interface ContentBlock {
  type: 'text' | 'tool_use' | 'workflow_created';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  workflowId?: string;
  workflowName?: string;
}

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string | ContentBlock[];
  timestamp: string;
}

interface MessageItemProps {
  message: Message;
}

// Matches [WORKFLOW_CREATED:workflowId:workflowName]
const WORKFLOW_CREATED_REGEX = /\[WORKFLOW_CREATED:([^:\]]+):([^\]]+)\]/g;

/**
 * Split a text block into segments — plain text and inline workflow cards.
 * Returns an array of renderable elements.
 */
function renderTextWithWorkflowCards(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  // Reset regex state
  WORKFLOW_CREATED_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WORKFLOW_CREATED_REGEX.exec(text)) !== null) {
    // Text before the marker
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      parts.push(
        <div
          key={`${keyPrefix}-text-${lastIndex}`}
          className="text-foreground prose prose-invert max-w-none"
        >
          <MarkdownContent content={before} />
        </div>
      );
    }

    // The workflow card
    parts.push(
      <WorkflowCreatedCard
        key={`${keyPrefix}-wf-${match[1]}`}
        workflowId={match[1]}
        workflowName={match[2]}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last marker
  const remaining = text.slice(lastIndex);
  if (remaining.trim()) {
    parts.push(
      <div
        key={`${keyPrefix}-text-${lastIndex}`}
        className="text-foreground prose prose-invert max-w-none"
      >
        <MarkdownContent content={remaining} />
      </div>
    );
  }

  return parts;
}

const MessageItemComponent = ({ message }: MessageItemProps) => {
  if (message.type === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-muted text-foreground rounded-xl px-4 py-3 max-w-[90%]">
          <p className="whitespace-pre-wrap text-14">
            {typeof message.content === 'string' ? message.content : ''}
          </p>
        </div>
      </div>
    );
  }

  // Assistant message with content blocks
  const contentBlocks = Array.isArray(message.content) ? message.content : [];

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-foreground font-semibold text-14">b0t</span>
        <span className="text-12 text-muted-foreground">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>

      {/* Render content blocks in order */}
      <div className="space-y-0">
        {contentBlocks.map((block, idx) => {
          if (block.type === 'workflow_created' && block.workflowId && block.workflowName) {
            return (
              <WorkflowCreatedCard
                key={`wf-${block.workflowId}-${idx}`}
                workflowId={block.workflowId}
                workflowName={block.workflowName}
              />
            );
          } else if (block.type === 'text') {
            const text = block.text || '';
            // Check for inline [WORKFLOW_CREATED:id:name] markers.
            // Use includes() rather than the module-level /g regex's .test()
            // to avoid mutating shared regex state during render.
            if (text.includes('[WORKFLOW_CREATED:')) {
              return (
                <React.Fragment key={idx}>
                  {renderTextWithWorkflowCards(text, `block-${idx}`)}
                </React.Fragment>
              );
            }
            return (
              <div key={idx} className="text-foreground prose prose-invert max-w-none">
                <MarkdownContent content={text} />
              </div>
            );
          } else if (block.type === 'tool_use') {
            return (
              <ToolDisplay
                key={block.id || idx}
                toolName={block.name || 'unknown'}
                toolInput={block.input || {}}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
};

export const MessageItem = memo(MessageItemComponent);

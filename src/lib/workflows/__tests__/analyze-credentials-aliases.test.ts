import { describe, expect, it } from 'vitest';
import { analyzeWorkflowCredentials, normalizeWorkflowPlatform } from '../analyze-credentials';

describe('analyze-credentials platform normalization', () => {
  it('normalizes Google and Microsoft platform aliases', () => {
    expect(normalizeWorkflowPlatform('google_sheets')).toBe('google-sheets');
    expect(normalizeWorkflowPlatform('googledrive')).toBe('google-drive');
    expect(normalizeWorkflowPlatform('googlecalendar')).toBe('google-calendar');
    expect(normalizeWorkflowPlatform('microsoft_teams')).toBe('microsoft-teams');
    expect(normalizeWorkflowPlatform('microsoft_onedrive')).toBe('onedrive');
  });

  it('normalizes explicit credential references to canonical workflow platform ids', () => {
    const credentials = analyzeWorkflowCredentials({
      steps: [
        {
          id: 'step-1',
          inputs: {
            token: '{{user.google_sheets}}',
          },
        },
      ],
    });

    expect(credentials).toHaveLength(1);
    expect(credentials[0].platform).toBe('google-sheets');
  });

  it('normalizes module platform ids used in workflow steps', () => {
    const credentials = analyzeWorkflowCredentials({
      steps: [
        {
          id: 'step-1',
          module: 'data.microsoft_onedrive.listFiles',
          inputs: {},
        },
      ],
    });

    expect(credentials).toHaveLength(1);
    expect(credentials[0].platform).toBe('onedrive');
    expect(credentials[0].type).toBe('oauth');
  });
});

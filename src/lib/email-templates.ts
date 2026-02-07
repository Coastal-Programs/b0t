interface InvitationEmailParams {
  organizationName: string;
  inviterName: string;
  role: string;
  inviteUrl: string;
  expiresInDays: number;
}

export function getInvitationEmailHtml(params: InvitationEmailParams): string {
  const { organizationName, inviterName, role, inviteUrl, expiresInDays } = params;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:32px 32px 24px;">
          <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#18181b;">${organizationName}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46;">
            ${inviterName} has invited you to join <strong>${organizationName}</strong> as a <strong>${role}</strong>.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
            <tr><td style="background-color:#18181b;border-radius:6px;padding:12px 24px;">
              <a href="${inviteUrl}" style="color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;display:inline-block;">Accept Invitation</a>
            </td></tr>
          </table>
          <p style="margin:0;font-size:13px;color:#71717a;">
            This invitation expires in ${expiresInDays} day${expiresInDays !== 1 ? 's' : ''}. If you didn&apos;t expect this email, you can safely ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

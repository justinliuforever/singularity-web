import "server-only";

// Gmail/QQ mail strip <style> and web fonts, so everything below must stay
// inline-styled and table-laid-out.
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

export function renderEmailShell(args: {
  preheader: string;
  bodyHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Goooose</title>
</head>
<body style="margin:0;padding:0;background-color:#FFFFFF;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${args.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background-color:#FFFFFF;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:56px 24px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="13" height="13" bgcolor="#E8850C" style="background-color:#E8850C;border-radius:3px;font-size:0;line-height:0;">&nbsp;</td>
                <td style="padding-left:9px;font-family:${FONT};font-size:17px;font-weight:700;color:#0A0A0A;letter-spacing:-0.2px;">Goooose</td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="padding-top:40px;">${args.bodyHtml}</td></tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:44px;">
              <tr>
                <td height="1" bgcolor="#EAEAEA" style="background-color:#EAEAEA;font-size:0;line-height:0;">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding-top:20px;font-family:${FONT};font-size:12px;line-height:1.9;color:#A3A3A3;">
                  此邮件由系统自动发送，请勿直接回复<br>
                  &copy; Goooose &middot; <a href="https://goooose.com" style="color:#A3A3A3;text-decoration:underline;">goooose.com</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function renderApprovalEmail(baseUrl: string): string {
  const bodyHtml = `
<h1 style="margin:0;font-family:${FONT};font-size:20px;font-weight:600;color:#0A0A0A;letter-spacing:-0.3px;">欢迎加入 Goooose 内测</h1>
<p style="margin:16px 0 0;font-family:${FONT};font-size:14px;line-height:1.9;color:#525252;">
  你的申请已通过，现在可以登录使用🎉<br>
  登录后从添加第一个对标账号开始，跑通「看对标 → 出选题 → 写稿」。
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
  <tr>
    <td bgcolor="#0A0A0A" style="background-color:#0A0A0A;border-radius:8px;">
      <a href="${baseUrl}" target="_blank" style="display:inline-block;padding:11px 26px;font-family:${FONT};font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">进入 Goooose</a>
    </td>
  </tr>
</table>
<p style="margin:16px 0 0;font-family:${FONT};font-size:13px;line-height:1.8;color:#A3A3A3;">
  使用申请时的邮箱登录
</p>`;
  return renderEmailShell({
    preheader: "你的申请已通过，现在可以登录使用",
    bodyHtml,
  });
}

// Never throws: approval must succeed even when Resend is unconfigured or down.
export async function sendApprovalEmail(to: string): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from || !to) {
    return { sent: false, reason: "email_not_configured" };
  }
  const baseUrl = process.env.LOGTO_BASE_URL ?? "https://goooose.com";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: "搬砖小鹅 Goooose 内测申请已通过",
        html: renderApprovalEmail(baseUrl),
      }),
    });
    if (!res.ok) {
      return { sent: false, reason: `resend_${res.status}` };
    }
    return { sent: true };
  } catch {
    return { sent: false, reason: "resend_network_error" };
  }
}

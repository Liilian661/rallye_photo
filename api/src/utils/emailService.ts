import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

const FROM = process.env.SMTP_FROM || '"Rallye Photo" <noreply@rallye-photo.com>';
const PANEL_URL = process.env.PANEL_URL || 'https://panel.rallye-photo.com';

// ---------- TEMPLATES ----------

function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8F5FD;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #EDE8F4;">
    <div style="background-color:#7B4AFF;padding:24px;text-align:center;">
      <h1 style="margin:0;font-size:24px;color:#110B22;font-weight:700;">rallye<span style="color:#fff;">.</span>photo</h1>
    </div>
    <div style="padding:32px 24px;">
      ${content}
    </div>
    <div style="padding:16px 24px;background:#F8F5FD;text-align:center;font-size:12px;color:#9B95B0;">
      &copy; ${new Date().getFullYear()} Rallye Photo &mdash; Tous droits r&#233;serv&#233;s
    </div>
  </div>
</body>
</html>`;
}

// ---------- SEND FUNCTIONS ----------

export async function sendVerificationEmail(email: string, firstName: string, token: string): Promise<void> {
  const verifyUrl = `${PANEL_URL}/auth/verify?token=${token}`;

  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1A1A2E;">Bienvenue ${firstName} !</h2>
    <p style="color:#6B5A8E;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Merci de vous &#234;tre inscrit sur Rallye Photo. Cliquez sur le bouton ci-dessous pour v&#233;rifier votre adresse email.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${verifyUrl}" style="display:inline-block;background-color:#FF2D78;color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:50px;text-decoration:none;">
        V&#233;rifier mon email
      </a>
    </div>
    <p style="color:#9B95B0;font-size:12px;line-height:1.5;margin:0;">
      Si le bouton ne fonctionne pas, copiez ce lien :<br/>
      <a href="${verifyUrl}" style="color:#4A3AFF;word-break:break-all;">${verifyUrl}</a>
    </p>
  `);

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Verifiez votre email - Rallye Photo',
    html,
  });
}

export async function sendResetPasswordEmail(email: string, firstName: string, token: string): Promise<void> {
  const resetUrl = `${PANEL_URL}/auth/reset-password?token=${token}`;

  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1A1A2E;">R&#233;initialisation du mot de passe</h2>
    <p style="color:#6B5A8E;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Bonjour ${firstName}, vous avez demand&#233; &#224; r&#233;initialiser votre mot de passe. Cliquez sur le bouton ci-dessous. Ce lien expire dans 1 heure.
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${resetUrl}" style="display:inline-block;background-color:#FF2D78;color:#ffffff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:50px;text-decoration:none;">
        R&#233;initialiser mon mot de passe
      </a>
    </div>
    <p style="color:#9B95B0;font-size:12px;line-height:1.5;margin:0;">
      Si vous n'avez pas fait cette demande, ignorez cet email.<br/>
      <a href="${resetUrl}" style="color:#4A3AFF;word-break:break-all;">${resetUrl}</a>
    </p>
  `);

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Reinitialiser votre mot de passe - Rallye Photo',
    html,
  });
}

export async function testConnection(): Promise<boolean> {
  try {
    await transporter.verify();
    console.log('SMTP connection OK');
    return true;
  } catch (err) {
    console.error('SMTP connection failed:', err);
    return false;
  }
}
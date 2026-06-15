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

export async function sendWelcomeEmail(email: string, firstName: string): Promise<void> {
  const panelUrl = PANEL_URL;
  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:22px;color:#1A1A2E;">Bienvenue ${firstName} !</h2>
    <p style="color:#6B5A8E;font-size:15px;line-height:1.6;margin:0 0 8px;">
      Votre email est v&#233;rifi&#233;. Vous &#234;tes pr&#234;t&#8239;&#183;e &#224; organiser votre premier rallye photo.
    </p>
    <p style="color:#6B5A8E;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Voici comment d&#233;marrer en 3 minutes&nbsp;:
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
      <tr>
        <td width="32" valign="top" style="padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#FF2D78;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:24px;">1</div>
        </td>
        <td style="padding-left:10px;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#1A1A2E;">Cr&#233;ez un &#233;v&#233;nement</p>
          <p style="margin:0;font-size:13px;color:#9B95B0;">Nom, date, deadline, mode de jeu.</p>
        </td>
      </tr>
      <tr><td colspan="2" style="height:14px;"></td></tr>
      <tr>
        <td width="32" valign="top" style="padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#FF2D78;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:24px;">2</div>
        </td>
        <td style="padding-left:10px;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#1A1A2E;">Ajoutez des d&#233;fis photo</p>
          <p style="margin:0;font-size:13px;color:#9B95B0;">Titre, points, mode surprise si vous le souhaitez.</p>
        </td>
      </tr>
      <tr><td colspan="2" style="height:14px;"></td></tr>
      <tr>
        <td width="32" valign="top" style="padding-top:2px;">
          <div style="width:24px;height:24px;border-radius:50%;background:#FF2D78;color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:24px;">3</div>
        </td>
        <td style="padding-left:10px;">
          <p style="margin:0;font-size:14px;font-weight:600;color:#1A1A2E;">Partagez le code &#224; vos participants</p>
          <p style="margin:0;font-size:13px;color:#9B95B0;">QR code ou code court &#8212; ils rejoignent en 10 secondes.</p>
        </td>
      </tr>
    </table>
    <div style="text-align:center;margin:0 0 24px;">
      <a href="${panelUrl}/dashboard/events/new" style="display:inline-block;background-color:#FF2D78;color:#ffffff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;text-decoration:none;">
        Cr&#233;er mon premier &#233;v&#233;nement
      </a>
    </div>
    <p style="color:#9B95B0;font-size:12px;line-height:1.5;margin:0;text-align:center;">
      Une question ? R&#233;pondez directement &#224; cet email, on vous r&#233;pond.
    </p>
  `);

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Bienvenue sur Rallye Photo, ${firstName} !`,
    html,
  });
}

export async function sendProCancellationEmail(
  email: string,
  firstName: string,
  subscriptionEndDate: Date,
  gracePeriodEnd: Date
): Promise<void> {
  const panelUrl = PANEL_URL;
  const endStr  = subscriptionEndDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const graceStr = gracePeriodEnd.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const html = baseTemplate(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#1A1A2E;">Votre abonnement Pro se termine</h2>
    <p style="color:#6B5A8E;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Bonjour ${firstName}, votre abonnement Pro a &#233;t&#233; annul&#233; et prendra fin le <strong>${endStr}</strong>.
    </p>

    <div style="background:#FFF5F8;border-left:3px solid #FF2D78;padding:14px 16px;border-radius:0 8px 8px 0;margin:0 0 20px;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#1A1A2E;">&#128274; P&#233;riode de gr&#226;ce : 48h</p>
      <p style="margin:0;font-size:13px;color:#6B5A8E;line-height:1.6;">
        Jusqu&apos;au <strong>${graceStr}</strong>, vos galeries restent accessibles en lecture seule.
        Aucune nouvelle soumission ne sera accept&#233;e apr&#232;s la fin de l&apos;abonnement.
      </p>
    </div>

    <p style="color:#6B5A8E;font-size:14px;line-height:1.6;margin:0 0 8px;">
      <strong>Ce qui change apr&#232;s la p&#233;riode de gr&#226;ce&nbsp;:</strong>
    </p>
    <ul style="color:#6B5A8E;font-size:13px;line-height:1.8;margin:0 0 20px;padding-left:20px;">
      <li>Vos &#233;v&#233;nements passent aux limites du plan Gratuit (5 d&#233;fis, 20 participants)</li>
      <li>L&apos;acc&#232;s aux galeries est limit&#233; &#224; 48h apr&#232;s la deadline</li>
      <li>L&apos;export ZIP ne sera plus disponible</li>
    </ul>

    <div style="text-align:center;margin:0 0 16px;">
      <a href="${panelUrl}/dashboard/pricing" style="display:inline-block;background-color:#FF2D78;color:#ffffff;font-weight:700;font-size:15px;padding:14px 36px;border-radius:50px;text-decoration:none;">
        R&#233;activer mon abonnement Pro
      </a>
    </div>
    <p style="color:#9B95B0;font-size:12px;text-align:center;margin:0;">
      Vous pouvez r&#233;activer &#224; tout moment avant le ${graceStr}.
    </p>
  `);

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Votre abonnement Pro Rallye Photo se termine',
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
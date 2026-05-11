const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = `Nooka <noreply@nooka.ca>`;

async function sendWelcome(toEmail, firstName) {
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Welcome to Nooka 🫧',
    html: `
      <h2>Hi ${firstName}, welcome to Nooka!</h2>
      <p>Less time planning, more time living.</p>
      <p>Get started by adding items to your pantry.</p>
      <a href="https://nooka.ca/pantry"
         style="background:#1D9E75;color:#fff;padding:10px 20px;
                border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px">
        Open Nooka
      </a>`
  });
}

async function sendPasswordReset(toEmail, resetToken) {
  const link = `https://nooka.ca/reset-password?token=${resetToken}`;
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Reset your Nooka password',
    html: `
      <h2>Password reset request</h2>
      <p>Click the link below. It expires in 1 hour.</p>
      <a href="${link}"
         style="background:#1D9E75;color:#fff;padding:10px 20px;
                border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px">
        Reset password
      </a>
      <p style="font-size:12px;color:#888;margin-top:16px">
        If you didn't request this, ignore this email.
      </p>`
  });
}

async function sendExpiryAlert(toEmail, firstName, items) {
  const rows = items.map(i =>
    `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${i.expiresIn} days</td>
    </tr>`
  ).join('');

  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `⚠️ ${items.length} item(s) expiring soon — Nooka`,
    html: `
      <h2>Hi ${firstName}, heads up!</h2>
      <p>These pantry items are expiring soon:</p>
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #eee">Item</th>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #eee">Expires in</th>
        </tr>
        ${rows}
      </table>
      <a href="https://nooka.ca/pantry"
         style="background:#1D9E75;color:#fff;padding:10px 20px;
                border-radius:8px;text-decoration:none;display:inline-block;margin-top:16px">
        View pantry
      </a>`
  });
}

async function sendFamilyInvite(toEmail, memberName, familyName, inviteToken) {
  const link = `https://nooka.ca/accept-invite?token=${inviteToken}`;
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: `You've been invited to join ${familyName} on Nooka`,
    html: `
      <h2>Hi ${memberName}, you're invited! 🫧</h2>
      <p><strong>${familyName}</strong> has added you to their family on Nooka — a smart meal planning and grocery app for Canadian families.</p>
      <p>Click below to set your password and start using the app.</p>
      <a href="${link}"
         style="background:#1D9E75;color:#fff;padding:10px 20px;
                border-radius:8px;text-decoration:none;display:inline-block;margin-top:12px">
        Accept invite & set password
      </a>
      <p style="font-size:12px;color:#888;margin-top:16px">
        This link expires in 7 days. If you didn't expect this, you can safely ignore it.
      </p>`
  });
}

module.exports = { sendWelcome, sendPasswordReset, sendExpiryAlert, sendFamilyInvite };
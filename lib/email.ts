import { Resend } from 'resend';
import type { TieredSlip } from '@/lib/types';

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  return new Resend(apiKey);
}

export async function sendDailySlip(userEmail: string, slips: TieredSlip[]) {
  const resend = getResend();

  await resend.emails.send({
    from: 'ParlayGuard <picks@parlayguard.com>',
    to: userEmail,
    subject: `Your Daily ParlayGuard Slips - ${new Date().toLocaleDateString()}`,
    html: `
      <h2>Today's Protected Slips</h2>
      ${slips
        .map(
          (s) =>
            `<p><strong>${s.tier}</strong>: ${s.odds} — Confidence ${s.overall}%</p>`,
        )
        .join('')}
      <p>AI Council Consensus Attached</p>
    `,
  });
}

export async function sendDailySlipsToRecipients(
  emails: string[],
  slips: TieredSlip[],
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const email of emails) {
    try {
      await sendDailySlip(email.trim(), slips);
      sent++;
    } catch (error) {
      failed++;
      console.error(`Failed to send daily slip to ${email}:`, error);
    }
  }

  return { sent, failed };
}

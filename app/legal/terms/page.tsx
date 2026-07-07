import type { Metadata } from 'next';
import Link from 'next/link';
import { COMPLIANCE_DISCLAIMER } from '@/lib/leg-compliance';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'SLIPPR Terms of Service — subscription analytics platform, informational use only.',
};

const EFFECTIVE = 'July 7, 2026';

export default function TermsPage() {
  return (
    <article className="legal-prose">
      <p className="eyebrow mb-3">Legal</p>
      <h1>Terms of Service</h1>
      <p className="legal-muted">Effective {EFFECTIVE}</p>

      <p>
        Welcome to SLIPPR (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), operated at{' '}
        <Link href="/">slippr.vercel.app</Link> and related domains (the &quot;Service&quot;).
        By accessing or using the Service, you agree to these Terms of Service (&quot;Terms&quot;).
        If you do not agree, do not use the Service.
      </p>

      <h2>1. What SLIPPR Is — and Is Not</h2>
      <p>
        SLIPPR is a <strong>subscription sports analytics and handicapping research platform</strong>.
        We provide model-generated grades, leg boards, fade alerts, council transparency, and related
        tools to help you analyze sports betting markets.
      </p>
      <p>SLIPPR is <strong>not</strong> a sportsbook, casino, or gambling operator. We do not:</p>
      <ul>
        <li>Accept, hold, or settle wagers or deposits</li>
        <li>Place bets on your behalf</li>
        <li>Guarantee profits or outcomes</li>
        <li>Provide personalized financial or legal advice</li>
      </ul>
      <p>
        Any wagering you choose to do is solely between you and a licensed operator in your
        jurisdiction, at your own risk.
      </p>

      <h2>2. Informational Use Only</h2>
      <p>{COMPLIANCE_DISCLAIMER}</p>
      <p>
        Graded picks, fade alerts, predatory line warnings, and council consensus outputs are
        algorithmic research products. They may be wrong. Past performance displayed on the
        platform does not guarantee future results.
      </p>

      <h2>3. Eligibility</h2>
      <p>
        You must be at least <strong>18 years old</strong> (or the minimum age required in your
        jurisdiction, including 21+ where applicable) to use the Service. By using SLIPPR, you
        represent that you meet this requirement and that your use complies with all applicable
        local, state, and federal laws.
      </p>

      <h2>4. Subscriptions &amp; Billing</h2>
      <p>
        Paid plans are billed in advance on a recurring basis through Stripe. By subscribing, you
        authorize us to charge your payment method for the selected plan. Free trials, where
        offered, convert to paid plans unless canceled before the trial ends.
      </p>
      <p>
        You may cancel at any time through your account billing portal. Access continues until the
        end of the current billing period. We do not provide refunds except where required by law.
      </p>

      <h2>5. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Scrape, resell, or redistribute SLIPPR data without permission</li>
        <li>Attempt to circumvent paywalls, rate limits, or access controls</li>
        <li>Use the Service to operate an unlicensed gambling business</li>
        <li>Misrepresent SLIPPR outputs as guaranteed winning picks</li>
      </ul>

      <h2>6. Fade Alerts &amp; Risk Features</h2>
      <p>
        Fade alerts and predatory line warnings identify lines our models flag as potentially
        overpriced or poor value. These are <strong>research outputs separated from standard graded
        picks</strong> for transparency. They are not instructions to wager and do not constitute
        a recommendation to take any specific action at any sportsbook.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF
        ANY KIND, EXPRESS OR IMPLIED, INCLUDING ACCURACY, MERCHANTABILITY, OR FITNESS FOR A
        PARTICULAR PURPOSE. WE DO NOT WARRANT THAT MODEL OUTPUTS WILL BE CORRECT, COMPLETE, OR
        USEFUL.
      </p>

      <h2>8. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, SLIPPR AND ITS OPERATORS SHALL NOT BE LIABLE FOR
        ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF
        PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE OR ANY WAGERING DECISIONS
        YOU MAKE BASED ON PLATFORM OUTPUTS.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update these Terms from time to time. Material changes will be posted on this page
        with an updated effective date. Continued use after changes constitutes acceptance.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions about these Terms:{' '}
        <a href="mailto:support@slippr.app">support@slippr.app</a>
      </p>

      <p className="legal-muted mt-12">
        See also:{' '}
        <Link href="/legal/responsible-play">Responsible Play</Link>
      </p>
    </article>
  );
}

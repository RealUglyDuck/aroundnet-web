import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using the AroundNet app and website, including AroundNet Pro subscriptions.",
};

const APPLE_EULA_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="2 October 2026"
      intro={
        <p>
          These terms apply when you use the AroundNet iPhone app or the website at
          aroundnet.co.uk (together, &ldquo;AroundNet&rdquo;). By using AroundNet you
          agree to them. If you got the app from the App Store, Apple&rsquo;s{" "}
          <a href={APPLE_EULA_URL} target="_blank" rel="noreferrer">
            Standard End User Licence Agreement
          </a>{" "}
          also applies.
        </p>
      }
    >
      <LegalSection title="1. Who we are">
        <p>
          AroundNet is run by Pawel Ambrozej, an individual based in the United Kingdom
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;). AroundNet is the name of the app, not a
          company. Contact:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. Who can use AroundNet">
        <p>
          You must be at least 13 to use AroundNet. If you are under 18, make sure a
          parent or guardian is happy for you to use it and to buy a subscription.
        </p>
      </LegalSection>

      <LegalSection title="3. Your account">
        <p>
          Some features need an account. Give accurate details, keep your password to
          yourself, and let us know if you think someone else has used your account.
          You are responsible for what happens under it. You can delete your account at
          any time in the app under Profile &rarr; Delete Account; this also deletes the
          tournaments, teams and organisations you created. Our{" "}
          <Link href="/privacy/">Privacy Policy</Link> explains what we store and why.
        </p>
      </LegalSection>

      <LegalSection title="4. AroundNet Pro">
        <ul>
          <li>
            AroundNet Pro is an auto-renewing subscription, offered monthly or yearly,
            that unlocks extra features. What Pro includes is shown in the app before
            you buy. Prices are shown in the app in your local currency.
          </li>
          <li>
            Pro is sold to your AroundNet account, so you need to be signed in to buy
            it, and it stays with that account.
          </li>
          <li>
            Payment is taken by Apple from your Apple ID when you confirm the purchase.
            The subscription renews automatically for the same period and price unless
            you turn off auto-renew at least 24 hours before the end of the current
            period. You can manage or cancel it in your Apple ID&rsquo;s subscription
            settings, or from your profile in the app.
          </li>
          <li>
            Where a free trial is offered, you are charged when it ends unless you
            cancel at least 24 hours before. Any unused part of a trial ends if you buy
            a subscription.
          </li>
          <li>
            Cancelling stops the next renewal; you keep Pro until the end of the period
            you paid for. Refunds for App Store purchases are handled by Apple under its
            policies — you can request one at{" "}
            <a href="https://reportaproblem.apple.com" target="_blank" rel="noreferrer">
              reportaproblem.apple.com
            </a>
            . This does not affect your rights under consumer law.
          </li>
          <li>
            We may change what Pro includes or what it costs. Price changes follow the
            App Store&rsquo;s rules and are never applied to a period you have already
            paid for.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Your content">
        <p>
          Your videos, edits, scoreboards, tournaments and other content remain yours.
          Videos you record or edit stay on your device unless you share them
          yourself. For content you put on AroundNet&rsquo;s servers — your profile,
          tournaments, teams, results and Reframe backups — you give us permission to
          store and display it as needed to run AroundNet. For example, a public
          tournament and its results are shown to everyone. That permission ends when
          you delete the content or your account.
        </p>
        <p>
          Only add content you have the right to use, and only add other people&rsquo;s
          names and details to teams and tournaments with their agreement.
        </p>
      </LegalSection>

      <LegalSection title="6. Keep your own copies">
        <p>
          Videos, serve clips and scoreboards are stored only on your device. If you
          delete the app, lose your phone or remove a clip, we cannot recover them.
          Export or back up anything you want to keep.
        </p>
      </LegalSection>

      <LegalSection title="7. Acceptable use">
        <p>Don&rsquo;t use AroundNet to:</p>
        <ul>
          <li>break the law or infringe anyone else&rsquo;s rights;</li>
          <li>harass, impersonate or mislead other people;</li>
          <li>collect or misuse other users&rsquo; personal information;</li>
          <li>
            interfere with AroundNet, get around its security or paid features, or
            access it with automated tools.
          </li>
        </ul>
        <p>
          We may remove content or suspend or close an account that breaks these terms.
          Where reasonable, we&rsquo;ll tell you why first.
        </p>
      </LegalSection>

      <LegalSection title="8. Tournaments">
        <p>
          Tournament organisers are responsible for their events: the details they
          publish, how they run the event, and the results they record. AroundNet
          provides the tools; we don&rsquo;t organise, run or supervise events and
          aren&rsquo;t a party to any arrangement between organisers and players.
        </p>
      </LegalSection>

      <LegalSection title="9. Play safely">
        <p>
          AroundNet&rsquo;s court lines, serve detection, timers and scores are training
          and organising aids. They are not official measurements or rulings and may
          not always be accurate. Roundnet is a physical sport: take part at your own
          risk, and look out for your surroundings, especially while using the camera.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes and availability">
        <p>
          We work to keep AroundNet available and accurate, but we provide it as it is
          and can&rsquo;t promise it will always be uninterrupted or error-free. We may
          change, add or remove features. If we stop offering Pro, active subscriptions
          won&rsquo;t renew.
        </p>
      </LegalSection>

      <LegalSection title="11. Our responsibility to you">
        <p>
          Nothing in these terms limits our liability for death or personal injury
          caused by our negligence, for fraud, or for anything else that the law does
          not allow us to limit, and nothing affects your statutory rights as a
          consumer.
        </p>
        <p>
          Otherwise, we are not responsible for losses that were not foreseeable, for
          loss of content stored on your device, or for business losses. AroundNet is
          for personal and community use.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes to these terms">
        <p>
          We may update these terms, for example when AroundNet changes or the law
          does. We&rsquo;ll change the date at the top and, for significant changes, let
          you know in the app. If you keep using AroundNet after a change, the new terms
          apply; if you don&rsquo;t agree, you can stop using it and delete your
          account.
        </p>
      </LegalSection>

      <LegalSection title="13. Law">
        <p>
          These terms are governed by the law of England and Wales, and the courts of
          England and Wales can hear disputes about them. If you live in Scotland or
          Northern Ireland, you can also bring proceedings in your local courts, and
          you keep the protection of the mandatory consumer laws where you live.
        </p>
      </LegalSection>

      <LegalSection title="14. Contact">
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

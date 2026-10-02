import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_CONTACT_EMAIL, LegalPage, LegalSection } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What the AroundNet app and website collect, why, who it is shared with, and your rights.",
};

// Written from what the apps actually do. When a feature starts collecting,
// sending or sharing something new, this page — and the App Store privacy
// label — change with it, and so does the date.
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="2 October 2026"
      intro={
        <>
          <p>
            This policy explains what information the AroundNet iPhone app and the
            website at aroundnet.co.uk (together, &ldquo;AroundNet&rdquo;) collect, why,
            who it is shared with, and the choices and rights you have.
          </p>
          <p>
            In short: most of what you do in AroundNet — your videos, serve clips and
            scoreboards — stays on your device. What reaches us is your account, the
            tournaments and teams you take part in, backups of your Reframe edits, and
            whether you have AroundNet Pro. We don&rsquo;t use advertising or analytics
            tracking, and we don&rsquo;t sell your information.
          </p>
        </>
      }
    >
      <LegalSection title="1. Who we are">
        <p>
          AroundNet is run by Pawel Ambrozej, an individual based in the United Kingdom.
          AroundNet is the name of the app, not a company. For the purposes of UK data
          protection law, Pawel Ambrozej is the controller of your personal
          information. You can reach us at{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. What we collect and why">
        <p>
          <strong>Your account.</strong> To create an account you give us your email
          address, a password and your name. You can add a country, city and short bio
          to your profile. Your password is stored by our authentication provider in
          hashed form; we never see it. We use this to sign you in, to show who you are
          in teams and tournaments, and to send emails your account needs, such as
          confirming your address or resetting your password. We don&rsquo;t send
          marketing emails.
        </p>
        <p>
          <strong>Tournaments, teams and organisations.</strong> When you create or join
          a tournament, team or organisation, we store what you enter: names,
          descriptions, dates, the event&rsquo;s location, team rosters, match results
          and scores, and who created or manages it.
        </p>
        <p>
          <strong>Reframe edits.</strong> When you are signed in, your Reframe edits
          are backed up to your account so you can return to them on another device or
          after reinstalling. A backup holds the edit itself (where the frame is placed
          and which parts of the clip are kept), the clip&rsquo;s file name, length and
          dimensions, a fingerprint calculated from the file so the edit can be matched
          to the same clip again, and, on iPhone, the identifier Photos uses for that
          clip. <strong>The video itself is never uploaded.</strong>
        </p>
        <p>
          <strong>AroundNet Pro.</strong> Subscriptions are bought through the Apple App
          Store, which handles payment. We never receive your card or payment details.
          We receive, through our subscription provider, which plan your account has,
          when it started and when it renews or ends, and whether it is active, in a
          free trial or has been refunded. We use this to switch Pro features on and
          off, including on our other platforms.
        </p>
      </LegalSection>

      <LegalSection title="3. What stays on your device">
        <p>These are used only on your device and are not sent to us:</p>
        <ul>
          <li>
            <strong>Videos.</strong> Clips you record or import, serve recordings,
            folders, favourites, timelines and comparisons are stored in the app on
            your iPhone. On the website, videos you open in Reframe or Compare are
            processed in your browser and never uploaded.
          </li>
          <li>
            <strong>Scoreboards.</strong> Team names, player names, team pictures and
            scores you enter for a scoreboard are saved on your device only.
          </li>
          <li>
            <strong>Camera.</strong> The camera is used for augmented-reality court
            setup and to detect serves while you practise. Serve detection runs on your
            device; only the clips you choose to keep are saved, to your device.
          </li>
          <li>
            <strong>Microphone and speech recognition.</strong> Used to hear voice
            commands such as &ldquo;Service&rdquo;, &ldquo;Save&rdquo; or
            &ldquo;Skip&rdquo;. Speech is recognised on your device where your iPhone
            supports it; otherwise Apple&rsquo;s speech recognition service processes
            it under Apple&rsquo;s privacy policy. We never receive or store audio.
          </li>
          <li>
            <strong>Location.</strong> If you allow it, your approximate location is
            used to centre the tournament map near you. It is not sent to us or stored.
          </li>
          <li>
            <strong>Photo library.</strong> Used to open clips you choose and to save
            the videos you export. We don&rsquo;t read anything else in your library.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Who can see your information">
        <ul>
          <li>
            <strong>Other AroundNet users</strong> who are signed in can see your name
            and the profile details you add, so they can find you and add you to teams
            and tournaments.
          </li>
          <li>
            <strong>Public tournaments</strong> — their details, team names, rosters
            and results — can be seen by anyone, including people without an account.
            Private tournaments are visible only to the people involved.
          </li>
          <li>
            <strong>Organisers and staff</strong> of a tournament you take part in can
            see and manage its teams, rosters and scores.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Service providers we share with">
        <p>
          We use a small number of providers to run AroundNet. They process
          information only to provide their service to us:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> — account sign-in, database and backups. Data is
            stored in the European Union (Ireland).
          </li>
          <li>
            <strong>RevenueCat</strong> (United States) — keeps track of AroundNet Pro
            subscriptions. It receives your account&rsquo;s identifier and your
            purchase records from the App Store.
          </li>
          <li>
            <strong>Apple</strong> — App Store purchases, Apple Maps in the app, and
            speech recognition where it is not done on your device.
          </li>
          <li>
            <strong>CARTO</strong> — provides the map images on the website, so it
            receives your IP address when the map loads.
          </li>
          <li>
            <strong>GitHub Pages</strong> — hosts the website, so it receives your IP
            address when you visit.
          </li>
        </ul>
        <p>
          Where a provider is outside the UK, the transfer is protected by the
          safeguards UK law requires, such as the UK&ndash;US data bridge or standard
          contractual clauses. We may also disclose information if the law requires
          it. We do not sell or rent your personal information, and we don&rsquo;t
          share it for advertising.
        </p>
      </LegalSection>

      <LegalSection title="6. Cookies and browser storage">
        <p>
          The website uses your browser&rsquo;s local storage to keep you signed in and
          to remember a few display preferences. These are needed for the site to
          work. We don&rsquo;t use advertising or analytics cookies.
        </p>
      </LegalSection>

      <LegalSection title="7. Our legal bases">
        <p>Under UK data protection law we rely on:</p>
        <ul>
          <li>
            <strong>Contract</strong> — to provide your account, tournaments, backups
            and Pro features you have asked for.
          </li>
          <li>
            <strong>Legitimate interests</strong> — to keep AroundNet secure, prevent
            misuse and fix problems.
          </li>
          <li>
            <strong>Consent</strong> — for camera, microphone, speech recognition,
            location and photo access, which you can turn off at any time in your
            iPhone&rsquo;s Settings.
          </li>
          <li>
            <strong>Legal obligation</strong> — where the law requires us to keep or
            disclose information.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="8. How long we keep it">
        <p>
          We keep your account information for as long as you have an account. You can
          delete your account at any time in the app under Profile &rarr; Delete
          Account. This deletes your profile, your Reframe backups, your team and
          tournament memberships, and the tournaments, teams and organisations you
          created. Copies in routine backups are removed within a short period.
          Subscription records may be kept by Apple and RevenueCat for as long as they
          need them for accounting and legal reasons.
        </p>
        <p>
          Signing out or deleting the app removes nothing from our servers; deleting
          your account does. Videos and scoreboards on your device are removed when you
          delete them or the app.
        </p>
      </LegalSection>

      <LegalSection title="9. Your rights">
        <p>
          You have the right to ask for a copy of your information, to correct it, to
          have it deleted, to restrict or object to how we use it, and to receive it in
          a portable format. You can change most profile details yourself in the app or
          on the website. For anything else, email{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a> and
          we&rsquo;ll respond within one month.
        </p>
        <p>
          If you&rsquo;re unhappy with how we handle your information, you can
          complain to the Information Commissioner&rsquo;s Office at{" "}
          <a href="https://ico.org.uk" target="_blank" rel="noreferrer">
            ico.org.uk
          </a>
          , though we&rsquo;d appreciate the chance to put it right first.
        </p>
      </LegalSection>

      <LegalSection title="10. Children">
        <p>
          AroundNet is not intended for children under 13, and we don&rsquo;t knowingly
          collect information from them. If you believe a child under 13 has created
          an account, contact us and we&rsquo;ll delete it.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to this policy">
        <p>
          We&rsquo;ll update this page when AroundNet changes what it collects or how it
          uses it, and change the date at the top. If a change is significant, we&rsquo;ll
          also let you know in the app. Our <Link href="/terms/">Terms of Service</Link>{" "}
          explain the rules for using AroundNet.
        </p>
      </LegalSection>

      <LegalSection title="12. Contact">
        <p>
          Questions about this policy or your information:{" "}
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

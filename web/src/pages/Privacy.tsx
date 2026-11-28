import { useEffect, type ReactNode } from "react";
import { Logo } from "../components/Logo";

// The public privacy policy (/privacy), linked from Google's sign-in screen
// for the assistant's Calendar access. Readable without signing in.

const UPDATED = "28 November 2026";
const REPOSITORY = "https://github.com/sniffmypony/NUSHelper";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      <div className="space-y-2 text-[15px] leading-relaxed text-muted [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}

export function PrivacyPage() {
  useEffect(() => {
    const before = document.title;
    document.title = "Privacy policy · NUSHelper";
    return () => {
      document.title = before;
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:py-16">
      <header className="mb-8 flex items-center gap-3">
        <Logo size={40} />
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
            Privacy policy
          </h1>
          <p className="text-sm text-muted">NUSHelper · Updated {UPDATED}</p>
        </div>
      </header>

      <div className="space-y-8">
        <Section title="Who this covers">
          <p>
            NUSHelper is a personal planner and assistant: a Telegram bot and
            this website. Each copy is run by one person, for themselves, and
            only that person can sign in or use the bot. The person running a
            copy controls its data; this page describes what the software does
            with it.
          </p>
        </Section>

        <Section title="What it keeps">
          <p>
            In the database of the person running it (hosted on Supabase), and
            only to provide its features:
          </p>
          <ul>
            <li>
              Tasks, to-dos, reminders, repeating items and birthdays you add.
            </li>
            <li>
              Daily spending you log, and payments you choose to send it (from
              an Apple Pay shortcut or bank alert emails you forward through
              your own script).
            </li>
            <li>
              Assistant conversations on Telegram, kept for 7 days, and chats on
              the website, kept until you delete them.
            </li>
            <li>
              Settings and keys. Keys are encrypted and never shown again.
            </li>
          </ul>
        </Section>

        <Section title="Google user data">
          <p>
            With your permission, NUSHelper uses{" "}
            <strong>Google Calendar</strong> for the one calendar you choose:
          </p>
          <ul>
            <li>
              It reads events to show your calendar, send your morning summary
              and answer your questions about your schedule.
            </li>
            <li>
              It creates, changes or deletes events only when you ask, and asks
              you to confirm before the assistant adds or deletes one.
            </li>
          </ul>
          <p>
            It doesn't read Gmail or any other Google data through Google's
            APIs.
          </p>
          <p>
            When you ask the assistant about your calendar, the events needed
            for that answer are sent to the AI provider the person running this
            copy has set up, only to answer you. NUSHelper doesn't sell Google
            user data, use it for advertising, share it beyond what's needed for
            the features above, or use it to train AI models.
          </p>
          <p>
            NUSHelper's use and transfer of information received from Google
            APIs adheres to the{" "}
            <a
              className="font-medium text-accent-text hover:underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </Section>

        <Section title="Who else handles it">
          <ul>
            <li>Telegram, which delivers your messages to the bot.</li>
            <li>Vercel, which hosts the bot and this website.</li>
            <li>Supabase, which hosts the database.</li>
            <li>
              The AI provider set up for the assistant, for the messages you
              send it.
            </li>
            <li>
              Google Calendar, Canvas and NUSMods, only if they're connected.
            </li>
          </ul>
        </Section>

        <Section title="Removing it">
          <p>
            Tasks, chats and other items can be deleted on the website or in
            Telegram, and spending, tasks and chats can be downloaded from
            Settings. You can remove NUSHelper's access to your Google account
            at any time at{" "}
            <a
              className="font-medium text-accent-text hover:underline"
              href="https://myaccount.google.com/permissions"
            >
              myaccount.google.com/permissions
            </a>
            .
          </p>
        </Section>

        <Section title="Questions">
          <p>
            NUSHelper is open source. Its code, and a way to ask about it, are
            at{" "}
            <a
              className="font-medium text-accent-text hover:underline"
              href={REPOSITORY}
            >
              github.com/sniffmypony/NUSHelper
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}

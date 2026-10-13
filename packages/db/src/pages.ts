import type { Db } from "./client";
import { cmsPages } from "./schema";

/**
 * First drafts of the site pages (FR-ABT-01). Staff edit them in Admin; seeding never overwrites an edited page.
 * The terms, privacy and refund drafts follow SRS v2 decisions but must be reviewed by a lawyer before launch.
 */
export const DEFAULT_PAGES: { slug: string; title: string; body: string }[] = [
  {
    slug: "about",
    title: "About Force Pulse",
    body: `Force Pulse is where grassroots sport in India gets organised: tournaments, registration, live scores and player auctions in one place.

## What we do
- Organisers create a tournament, build their own registration form and collect entry fees online.
- Players register in minutes, follow every match live and build a profile of their games.
- Scorers keep score on a phone at the ground, even when the signal drops.
- Leagues form teams through a live, points-only player auction.

Force Pulse is run by Force Sports and Wears India.`,
  },
  {
    slug: "sports",
    title: "Sports and services",
    body: `## Sports with live scoring
Badminton, basketball, cricket, football, hockey, kabaddi, kho-kho, table tennis, tennis, volleyball and wrestling. Padel, pickleball, boxing, golf and throwball are coming.

## For organisers
- Registration forms you design, with fees per category
- Fixtures: league, knockout, or league then knockout
- Live scoring, points tables and brackets
- A photo and video gallery for every tournament
- Player auctions with points, priced by number of teams

## For players
- One player id across every tournament
- Live scores and a public profile with your stats and history
- Casual matches with friends`,
  },
  {
    slug: "partners",
    title: "Partners",
    body: `We work with clubs, academies, schools and sports brands to bring more tournaments online.

Want to partner with Force Pulse? Write to us through the contact page.`,
  },
  {
    slug: "faq",
    title: "Frequently asked questions",
    body: `## How do I register for a tournament?
Open the tournament's link or find it on the home page, log in with your mobile number and fill in the organiser's form.

## What does it cost?
Players pay the entry fee set by the organiser, plus a small convenience fee for the payment method charged by Razorpay. UPI is often free.

## How do refunds work?
Refunds, withdrawals and cancellations after registration are handled by the organiser under their refund policy, shown before you pay.

## When do organisers get paid?
Force Pulse keeps 3% of each entry fee. After the tournament is completed, the organiser contacts us and we transfer their 97% to their verified bank account.

## Is my information public?
Your name, photo, city and match history are public on your profile. Your mobile number, date of birth and pincode are never shown publicly.`,
  },
  {
    slug: "terms",
    title: "Terms of use",
    body: `These terms apply when you use Force Pulse. Draft: to be reviewed by a lawyer before launch.

## Accounts
You sign in with your own mobile number. You are responsible for what is done with your account.

## Tournaments
Organisers are responsible for running their tournaments, their rules, and any cancellations, withdrawals and refunds.

## Payments
Entry fees are collected through Razorpay. Force Pulse keeps a platform fee of 3% of each entry fee, which is not refunded. The convenience fee charged for the payment method is not refunded.

## Conduct
Do not misuse the platform, enter false information or interfere with other users. We may suspend accounts that do.`,
  },
  {
    slug: "privacy",
    title: "Privacy policy",
    body: `We follow India's Digital Personal Data Protection Act, 2023. Draft: to be reviewed by a lawyer before launch.

## What we collect
Your mobile number, the details organisers ask for in their registration forms, your match results, and payment records.

## How we use it
To run tournaments you enter, show live scores and your profile, take payments and contact you about your entries.

## What is public
Your name, photo, city, sports, results and badges. Never your mobile number, date of birth or pincode.

## Your rights
From your account page you can download your data and ask us to delete your account. Payment records are kept as long as the law requires.

## Contact
Use the contact page for any privacy question.`,
  },
  {
    slug: "refunds",
    title: "Payment and refund policy",
    body: `## Paying an entry fee
You pay the entry fee set by the organiser, plus a convenience fee for the payment method charged by Razorpay. Your place is held for 30 minutes while you pay.

## Refunds
Cancellations, withdrawals, rejections and refunds after registration are handled by the organiser, under the refund policy shown on their tournament before you pay. Force Pulse's 3% platform fee and the convenience fee are not refunded.

## Organiser payouts
After the tournament is completed, Force Pulse pays the organiser 97% of the entry fees collected, by bank transfer to their verified account.`,
  },
];

export async function seedPages(db: Db): Promise<void> {
  await db.insert(cmsPages).values(DEFAULT_PAGES).onConflictDoNothing();
}

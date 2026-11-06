# Privacy Policy

**Effective date:** November 6, 2026

## 1. Overview

This Privacy Policy explains how Quizymode collects, uses, stores, and shares information when you use `https://www.quizymode.com`.

## 2. Information We Collect

We may collect the following categories of information:

- **Account information:** email address, username, display name, and account metadata. Password handling is managed by AWS Cognito; Quizymode does not directly store your plain-text password. If you choose **Continue with Google**, see "Signing in with Google" below.
- **Content you create or submit:** items, collections, study guides, comments, feedback submissions, and similar material you enter into the service.
- **Usage and technical information:** page paths, query strings, session identifiers, authentication state, timestamps, browser user-agent strings (used to filter out automated traffic), and IP addresses associated with requests or page-view analytics.
- **Product engagement events:** a limited set of in-app events, such as starting or finishing a quiz and viewing or using sign-up prompts, recorded with the session identifier, your account when you are signed in, the app page, a coarse context (for example the quiz's category or collection), and for quizzes an anonymous run identifier, your score, and the number of questions. We do not record question text, the answers you choose, your email address, or free-form content in these events. We use them mainly in aggregate to understand where people engage or leave.
- **Diagnostic error reports:** when the app crashes or hits an error in your browser, it sends us a short report: the error name and message, a technical stack trace, the app page (without its query string), the app version, the session identifier, the visitor identifier described below (unless your browser signals Global Privacy Control), whether this is an internal test browser, your account when you are signed in, and the browser user-agent with a coarse device type (desktop, mobile, or tablet). Before a report is stored we strip query strings, email addresses, and access tokens from it. We use these reports only to find and fix bugs, send at most a few per browser tab, and delete them after 90 days.
- **Traffic attribution:** for the first page hit of a browsing session, we record the referring website's domain only (never the full referring URL), any campaign tags present in the link you followed (for example `utm_source`), whether the link carried a known advertising platform's click identifier (we record only which platform, such as Google or Microsoft Ads — never the identifier value itself), a coarse device type (mobile, tablet, or desktop), and an approximate country, region and city derived from your IP address. We use this mainly in aggregate to understand how visitors find the product.
- **Individual session review:** authorized Quizymode administrators may review the activity of a single browsing session or visitor (pages visited, engagement events, sign-in state, approximate location, and a truncated IP address) to answer support requests, investigate abuse, fraud or security issues, and diagnose product problems. We do not use this review for advertising or sell it.
- **Browser-stored data:** authentication tokens stored in browser `localStorage`; session-related data stored in browser `sessionStorage`, including page-view, engagement-event, and error-report tracking markers and study-flow state; and, only when you play quizzes without signing in, a short guest quiz history in browser `localStorage` (for each finished quiz: a random run identifier, the finish time, your score and question count, the collection or topic identifiers, and the IDs of up to a limited number of missed questions). Guest history stays in your browser: it is not sent to us, not linked to an account, and not synced across devices. It keeps at most your last 50 results for up to 90 days, and you can remove it with **Clear guest history** on the home page or by clearing your browser's site data.
- **Visitor identifier:** a randomly generated id stored in your browser's `localStorage` so we can recognize a returning visitor across tabs and visits. It is created the first time analytics would otherwise record a hit, unless your browser signals Global Privacy Control, in which case it is not created, read, or sent. You can clear it at any time by clearing this site's browsing data.

**Signing in with Google.** If you choose **Continue with Google**, Google shares basic profile information (such as your name, email address, whether Google has verified that email address, profile picture and locale) with AWS Cognito; Quizymode keeps only your name, email address and verified status. Our identity provider, AWS Cognito, also stores your Google account identifier. We use this only to create your account or sign you in, and to link it to an existing Quizymode account that uses the same verified email address. We do not access your Google contacts, Drive, Gmail, or calendar, and we do not use this information for advertising. Google's own handling of your data is described in Google's privacy policy.

## 3. How We Use Information

We use information we collect to:

- operate, maintain, and secure the service;
- authenticate users and manage accounts;
- store and display user content according to the product's sharing and visibility features;
- analyze app usage and improve product quality;
- investigate abuse, fraud, security incidents, and policy violations; and
- respond to support requests, feedback, takedown requests, or legal complaints.

## 4. Visibility and Sharing

Your visibility settings matter:

- public collections may be visible to other users and visitors;
- public items may be visible and discoverable through the app; and
- if you include private items inside a public collection, those items may be visible within that collection context even if they are not otherwise publicly discoverable in the app.

Please do not upload personal, confidential, or third-party content unless you have the right and lawful basis to do so.

## 5. Service Providers and Sharing

Quizymode uses third-party providers to operate the service, including:

- **AWS Cognito** for authentication, and **Google** as an optional sign-in method;
- **AWS Lightsail** for API hosting;
- **AWS S3 and CloudFront** for web hosting and delivery;
- **Supabase** for managed PostgreSQL storage;
- **Cloudflare** for DNS, TLS, and edge proxying;
- **ipinfo.io** for approximate, IP-based country resolution used in analytics;
- **Grafana Cloud** for logs, traces, metrics, and operational observability; and
- **Google Gemini API, Groq, Cerebras, OpenRouter, and OpenAI** for AI question generation from study guides you upload (see Section 6).

We may disclose information:

- to these providers as needed to operate the service;
- when required by law, legal process, or a good-faith belief that disclosure is necessary to protect rights, safety, or the service; or
- in connection with a reorganization, sale, financing, or transfer of all or part of the service or its assets.

We do not sell personal information, and the current app does not use third-party advertising cookies.

## 6. AI-Assisted Workflows

When you ask Quizymode to generate questions from a study guide you uploaded, the text of each section you choose is sent to a third-party AI provider, which returns draft questions. We send only the section text and our instructions; we do not send your name, email address, or account details. We clear the temporary generation copy once its questions are generated. Uploaded section text remains until the document expires, normally 30 days after its last activity, when cleanup removes the text.

Depending on availability, a section may be processed by one of these providers, tried in order until one succeeds:

- **Google Gemini API** (Google). On Google's free tier, Google may use submitted content to improve its products, and human reviewers may read it.
- **Groq**, which states it does not use API inputs to train models.
- **Cerebras**, which states it does not retain API inputs or use them for training.
- **OpenRouter**, which forwards the request to the model's upstream provider (for example Google for Gemma models). We configure OpenRouter not to route to providers that train on inputs or publish prompts.
- **OpenAI**, which states it does not use API inputs to train models by default.

Each provider handles the content under its own terms and privacy policy. Do not upload study guides that contain personal, confidential, or sensitive information.

Quizymode also includes copy/paste prompt workflows for external AI tools. If you paste content into an external AI tool, that provider handles it under its own terms and privacy practices.

## 7. Retention

We retain information for as long as reasonably necessary to operate the service, maintain security, resolve disputes, enforce our terms, and comply with legal obligations.

Usage analytics have fixed retention periods:

- **Page-view records** (page path and query string, session identifier, IP address, browser user-agent, and sign-in state) are deleted **180 days** after they are recorded.
- **Traffic-attribution records** for a browsing session (referring domain, campaign tags, device type, approximate country, region and city, and the visitor identifier) are deleted once they are older than 180 days and no page-view records for that session remain.
- **Product engagement events** (see "Product engagement events" above) are deleted **180 days** after they are recorded.
- **Daily usage totals** derived from those records (for example, counts of sessions and page views per day by app area, category or collection, traffic channel, device type, country, sign-in outcome, and new versus returning visitor) contain no session identifiers, visitor identifiers, IP addresses, or account identifiers, and may be kept longer to understand long-term trends.
- **Diagnostic error reports** are deleted after 90 days, as described above.

Because self-service account deletion is not currently available in the app, you may contact us at `legal@quizymode.com` if you want to request review of a deletion request.

## 8. Your Choices and Rights

Depending on where you live, you may have rights to request access to, correction of, deletion of, or export of personal information we hold about you.

You can also:

- manage whether certain content is kept private or shared through available product settings;
- update your profile name through the app; and
- edit or remove content you created using the product's available features.

## 9. Children's Privacy

Quizymode is not intended for children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child under 13 has provided personal information through the service, contact us at `legal@quizymode.com`.

## 10. Security

We use reasonable technical and organizational measures to protect information, but no method of storage or transmission over the internet is completely secure. We cannot guarantee absolute security.

## 11. International Processing

Quizymode and its service providers may process information in the United States and other countries. Those countries may have data-protection laws that are different from the laws where you live.

## 12. Changes to This Policy

We may update this Privacy Policy from time to time. When we do, we will update the effective date above. Your continued use of Quizymode after the updated policy takes effect means you acknowledge the revised policy.

## 13. Contact

For privacy questions, requests, or complaints, contact `legal@quizymode.com`.

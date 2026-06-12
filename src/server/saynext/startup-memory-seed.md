# SayNext Startup Memory Seed Compact v1

Stable personal memory facts about Xiang.

## Identity And Education

Xiang Li is a Chinese international student from Chengdu, Sichuan, China. His Chinese name is Li Xiang.

Xiang moved to Halifax, Nova Scotia during high school, around Grade 11 / high school Grade 2.

In Canada, Xiang attended Aubrey Drive High School in Dartmouth.

After high school, Xiang studied Computer Science at Acadia University and completed a Bachelor of Computer Science in May 2025.

Xiang is now in the Master of Applied Computer Science program at Dalhousie University. His expected graduation is around January 2027.

Xiang's academic and career interests include AI applications, cloud computing, system design, full-stack development, mobile apps, and real-time AI assistant systems.

Xiang chose Computer Science partly because he thought it could lead to a stable career and good income. He did not have a very clear goal at the beginning. After building projects, he gradually became more interested in CS because he could turn ideas into working software.

Xiang's undergraduate experience was affected by COVID. The first one or two years were mostly residence life and online classes, so that period felt isolated and not very vivid. Later university became more normal.

Xiang's bachelor's GPA was around 3.7. His resume GPA is around 3.73/4.33.

Xiang received the Class of 1969 Dr. L.J. Retallack Memorial Scholarship in 2022, 2023, and 2024. He was on the Dean's List in 2022 and 2024.

Xiang's current Summer 2026 courses include Advanced Cloud Architecting, Deep Learning Applications, and Recommender Systems.

Xiang's recent Dalhousie courses include cloud computing, web development, mobile computing, data management, software development, and communication for computer science.

## English And Speaking Style

Xiang started learning English when he was young, but he did not put much effort into it at first.

After moving to Canada, English became necessary for daily life, so Xiang improved through YouTube, reading, and talking with people.

Xiang's current weak point in English is advanced general vocabulary. He is more comfortable with basic IELTS-style words and technical terms.

Xiang's natural English style is simple, relaxed, casual, modest, and internet-native. He often sounds like a real international student speaking rather than a polished corporate speaker.

Xiang often uses words like probably, honestly, kind of, maybe, I guess, it depends, not really, and a bit.

Xiang dislikes sounding overly formal, corporate, motivational, over-polished, authoritative, or like a generic AI assistant.

In formal moments, Xiang still prefers a relaxed, humble, lightly warm style. He dislikes greeting-card language, corporate ceremony language, and over-dramatic speeches.

## Personality And Preferences

Xiang is introverted and comfortable being alone. He has a small social circle and does not like forced social energy.

Xiang prefers quiet, low-pressure environments with fewer interruptions.

Xiang prefers remote-friendly, engineering-heavy, low-politics, small or technical-oriented teams, async communication, and quiet work environments.

Xiang dislikes noisy offices, excessive meetings, high-pressure social culture, office politics, and 996 / hustle culture.

Xiang often works in interest-triggered bursts rather than stable grinding. He may procrastinate, but he usually finishes.

Xiang learns best through practical examples, building, testing, and AI-assisted iteration.

## Career And Technical Profile

Xiang is best described as a full-stack developer with AI and cloud application experience.

Xiang's stronger technical areas are practical app building, backend/API integration, database work, cloud/serverless basics, full-stack integration, connecting components together, practical system/application architecture, and making software actually work.

Xiang is more comfortable with practical system design and application architecture than competitive programming.

Xiang is less confident in LeetCode-heavy algorithms, advanced mathematics, deep ML theory, security, and DevOps.

Xiang has used C++, Java, Python, C#, JavaScript, and TypeScript through school and projects.

Xiang's current stronger languages are JavaScript and TypeScript because he uses them more often for web and app projects.

Xiang has some background in C++, Java, Python, and C# from school or earlier projects, but some of those are rusty because he has not used them much recently.

Xiang has practical experience with React, React Native, Expo, Firebase, Firestore, Firebase Authentication, REST APIs, backend logic, database integration, AWS serverless, Lambda, API Gateway, DynamoDB, S3, AWS SAM/CloudFormation, Terraform basics, Git/GitHub/GitLab, Postman, Figma, and API integration.

Xiang's resume positioning is hands-on experience building AI-powered web, mobile, and cloud applications.

## AI Workflow And Developer Identity

Xiang often uses AI as a first thinker, planner, analyzer, idea generator, decision assistant, communication helper, and thinking partner.

AI helps Xiang reduce mental startup cost, blank-page pressure, confusion, and communication insecurity.

Xiang's preferred AI-assisted development workflow is to let AI understand the project structure, break work into smaller pieces, define boundaries, use TDD-style thinking for deterministic modules, prefer diffs, explain trade-offs, generate checklists, and then manually review and test the final result.

Xiang's core AI workflow philosophy is that AI structures the work and the human verifies it.

Xiang dislikes AI responses with useless filler, fake confidence, pretending to understand, or guessing before inspecting context.

Xiang prefers concise, concrete, practical answers with honest uncertainty.

One important developer-identity shift for Xiang is that when AI makes frontend implementation easier, the differentiator becomes product feel, usability, and whether the app actually works for users.

Xiang cares more now about user experience and product feel, not just writing frontend code.

## Known Projects

Xiang's known projects include SayNext / Hybrid Search Memory Assistant, JobLens AI, ElderAlbum / Elder Album, Dal Parking Aid / DalParkAid, AI Meeting Monitor, Blood Donation Management System, Study Session Tracker, and AI Test Simulator.

## SayNext / Hybrid Search Memory Assistant

SayNext is Xiang's real-time conversation helper. Its public-facing project name is Hybrid Search Memory Assistant.

SayNext helps Xiang during live conversations by using transcript context, scene mode, memory, and LLM generation to suggest what he can say next.

SayNext's goal is to make Xiang sound calmer, clearer, and more prepared without sounding fake or over-polished.

SayNext has included live transcript handling, manual-first generation, scene modes, memory retrieval, OpenAI conversation/session context, VPS deployment, MentraOS / smart glasses display work, and experiments with EvenHub / G2 / R1 interaction.

SayNext is Xiang's own real-time AI assistant project and active development work.

## JobLens AI

JobLens AI is Xiang's strongest cloud/AWS project.

JobLens AI is a cloud-based web application for students and early-career job seekers.

JobLens AI reduces fragmented job-search work by collecting jobs from public sources, cleaning inconsistent metadata, deduplicating records, storing canonical jobs, supporting optional AI summaries and resume-based matching, and giving users a dashboard to save jobs and track applications.

Implemented surfaces include React frontend pages for landing, registration/sign-in, dashboard, job details, saved jobs, application tracker, and profile/resume upload.

Backend capabilities include registration/login, current user lookup, profile update, resume upload/parsing, job listing/detail, saving jobs, match analysis, application updates, and manual sync.

JobLens AI uses a React SPA served from S3, API Gateway in front of FastAPI running on Lambda, DynamoDB for structured app data, S3 for frontend assets/raw job payloads/source artifacts/uploaded resumes, CloudWatch for logs, and EventBridge or manual sync for ingestion.

Terraform is used for infrastructure as code.

The current JobLens demo sync path runs inline for Learner Lab reliability.

The planned scaling path uses SQS, ECS/Fargate, ECR, and a processor Lambda to separate interactive browsing from slower source ingestion and AI enrichment.

JobLens AI data includes users, jobs, saved_jobs, applications, job_matches, and sync_runs.

JobLens AI security baseline includes JWT auth, Argon2 password hashing, private resume/raw buckets, HTTPS through API Gateway, presigned upload targets, and CloudWatch logs.

Future hardening for JobLens AI includes CloudFront with private S3 origin, httpOnly cookies, restricted CORS, Secrets Manager or Parameter Store, narrower IAM, Cognito, and resume deletion controls.

JobLens AI reliability choices include reading stored data for normal browsing, keeping raw payloads for inspection/replay, using CloudWatch for logs, and falling back to heuristic summaries/matching if AI is disabled.

JobLens AI estimated demo cost is low single-digit CAD per month when AI is used sparingly.

## ElderAlbum / Elder Album

ElderAlbum is Xiang's AWS serverless photo album sharing app for older adults and family members.

ElderAlbum lets older adults create event-based albums with a name, date range, optional tags, upload multiple photos, edit album metadata and photo order, search by keyword/tag/date, generate a read-only share link, and let family members view the album without login.

ElderAlbum uses a React SPA hosted on S3, API Gateway REST API, multiple Lambda functions, DynamoDB tables for album/photo metadata, an S3 bucket for photo objects, and AWS SAM/CloudFormation for infrastructure.

GitLab CI can run tests/builds and deploy ElderAlbum with valid AWS credentials.

ElderAlbum uses an album table with albumId and indexes for ownerCode/shareToken, and a photo table with albumId and photoId.

ElderAlbum share workflow: owner creates or reuses a high-entropy shareToken, guest opens the share URL, backend fetches album/photos through DynamoDB indexes, and guest sees a read-only view.

ElderAlbum write actions go through the backend and use ownerCode. Guest viewing uses shareToken. Lambda mediates database access. API traffic uses HTTPS through API Gateway.

The ElderAlbum demo allowed public S3 photo access for simplicity.

Production improvements for ElderAlbum include private photos served through CloudFront with origin access control/signed URLs or presigned reads, Cognito authentication, per-user isolation, share link expiry/revocation, file size/type checks, thumbnails/compression, lifecycle rules, and CloudFront HTTPS/caching.

ElderAlbum helped Xiang learn how frontend, API Gateway, Lambda, DynamoDB, and S3 connect.

One challenge in ElderAlbum was debugging across services because one wrong permission, environment variable, API route, or S3/DynamoDB setting could break the full flow.

## DalParkAid / Dal Parking Aid

DalParkAid is Xiang's React Native / Expo mobile app for Dalhousie campus parking guidance.

DalParkAid estimates parking availability across Dalhousie parking lots using a probabilistic prediction engine plus crowdsourced reports.

The parking problem was that universities often lack reliable real-time parking data. Sensor systems are expensive, and pure crowdsourcing becomes stale.

DalParkAid combines baseline prediction with recent user reports.

Core features include color-coded map markers, five status tiers, lot detail panel, parking status prediction, crowd reports, optional report photo upload, Google Directions API navigation, route polyline, live GPS tracking, arrival detection around 50 meters, haptic feedback, and proximity-gated reporting.

The five status tiers are Empty, Normal, Crowded, Almost Full, and Full.

DalParkAid v2 prediction starts from a base score around 55 and adjusts with hourly/day-of-week patterns, weather from Open-Meteo, timetable/class load, academic calendar day types, lot type, lot size, and recent crowd reports.

Wednesday can have a stronger negative modifier due to class density.

In DalParkAid, users must be within about 30 meters of a lot to submit a report.

Crowd reports decay over time using exponential decay. Fresh reports dominate and older reports are excluded.

Crowd influence is capped so the baseline still contributes.

Community votes can adjust report weight, and leaderboard encourages participation.

DalParkAid evaluation included usability sessions with 10 Dalhousie participants.

Users liked color-coded markers and five-tier status labels more than raw percentages.

Proximity-gated reports increased trust.

DalParkAid limitations include small sample size, controlled evaluation environment, hand-tuned prediction parameters, cold start when no reporters exist, static timetable data, and arrival detection not automatically opening the report screen.

Future work for DalParkAid includes longitudinal deployment, ML trained on verified reports, auto-prompted reporting on arrival, push notifications, and reporter reputation.

## AI Meeting Monitor

AI Meeting Monitor was Xiang's graduate-level multi-service full-stack/AI project.

AI Meeting Monitor involved frontend, backend, data processing, and a Discord recording bot.

The frontend used React 19, TypeScript, Vite, React Router, Recharts, Vitest, and React Testing Library.

The frontend included dashboard, meeting list/detail, transcript timeline, action items, decisions, sentiment charts, reports, login/profile, and mock/API modes.

The backend used Flask, Flask-SQLAlchemy, PostgreSQL, Flask-Session, REST APIs, session-based auth, meeting/calendar/highlight/user endpoints, and an internal service-token endpoint for analysis write-back.

The data processing service used FastAPI, Faster Whisper for transcription, and Google Gemini for structured meeting analysis.

The data processing service produced summaries, sentiment, action items, decisions, risks, follow-ups, key notes, and references.

The data processing service used Pydantic schemas, transcript chunking, retry/fallback behavior, cache, and backend write-back.

The bot service used Node.js/Express, discord.js, @discordjs/voice, FFmpeg/prism-media, Swagger docs, rate limiting, Joi validation, Winston logging, and session management.

The bot could join/leave voice channels, record audio, save tracks, list/download sessions, and generate speaking analytics.

GitLab CI covered backend pytest, dataProcessing pytest/coverage, bot Jest tests, code-quality checks, frontend Vitest tests, and smoke/integration testing.

AI Meeting Monitor flow: create meeting, bot records Discord audio, dataProcessing downloads tracks and transcribes with Faster Whisper, combines transcript with speaker/timestamp information, sends transcript to Gemini for structured JSON analysis, writes summary/transcript/highlights back to Flask backend, and React frontend displays dashboard/report/detail views.

Xiang did not build the whole AI Meeting Monitor platform alone.

Xiang's safest role framing for AI Meeting Monitor is integration, frontend/backend/API wiring, debugging, testing, and demo stabilization.

Near the AI Meeting Monitor deadline, services were developed separately and final integration exposed API mismatches, data mapping issues, unclear ownership, state/polling problems, CI/CD issues, and demo-flow problems.

Xiang helped stabilize AI Meeting Monitor by checking API contracts, fixing frontend data mapping, validating backend write-back, smoke-testing dashboard/detail/report flows, and making the demo reliable enough for presentation.

AI Meeting Monitor's final demo worked, the project was complete enough, and it received an A grade.

AI Meeting Monitor used Faster Whisper and Gemini API rather than training a model from scratch.

## Blood Donation Management System

Blood Donation Management System was Xiang's first major project where he felt he could build real software.

Blood Donation Management System was an undergraduate group project using ASP.NET, C#, and a database-backed web architecture.

Xiang's main responsibilities were backend logic, database work, debugging, and integration.

The main lesson from Blood Donation Management System was understanding how frontend, backend, and database pieces connect.

Problems included database connection issues, field mismatches, form submission bugs, login/session problems, integration issues, merge problems, and small bugs wasting hours.

After finishing Blood Donation Management System, Xiang felt relief more than excitement.

Later, Blood Donation Management System became important because it proved Xiang could finish real software and that computer science was not only theory.

## Study Session Tracker

Study Session Tracker is Xiang's student productivity app using Firebase Authentication, Firestore, a study timer, dashboard, reminders, to-do list, and calendar-style planning.

Study Session Tracker lets users sign in, start and stop study sessions, review study history, manage tasks, set reminders, and connect study plans to calendar-like views.

Firebase Authentication identifies the user.

Firestore stores user-scoped records such as study sessions, tasks, reminders, and calendar entries.

The timer flow creates session records with start time, end time, duration, subject/category, and optional notes.

The dashboard aggregates records into recent sessions, total time, streak-like progress, or subject breakdowns.

Study Session Tracker turns vague study effort into visible progress by combining timer data, task planning, reminders, and history.

